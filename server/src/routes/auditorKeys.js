import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { auditorCertificateTrustConfigured, validateAuditorCertificate } from "../services/auditorCertificate.js";

const router = Router();

router.post("/", requireAuth, requireRole("auditor"), async (req, res) => {
  const allowedFields = new Set(["certificatePem", "publicKeySpki", "keyId"]);
  if (Object.keys(req.body || {}).some((field) => !allowedFields.has(field))) {
    return res.status(400).json({ error: "Only a public key, key identifier, and public certificate are accepted." });
  }

  let validated;
  if (auditorCertificateTrustConfigured()) {
    try {
      validated = validateAuditorCertificate({
        certificatePem: req.body?.certificatePem,
        publicKeySpki: req.body?.publicKeySpki,
        keyId: req.body?.keyId,
        auditorId: req.user.externalId,
      });
    } catch (error) {
      const trustDisabled = /validation is disabled|could not be loaded|not a CA certificate/.test(error.message);
      return res.status(trustDisabled ? 503 : 400).json({ error: error.message });
    }
  } else {
    if (!req.body?.publicKeySpki || !req.body?.keyId) {
      return res.status(400).json({ error: "Public key and keyId are required." });
    }
    validated = {
      keyId: req.body.keyId,
      publicKeySpki: req.body.publicKeySpki,
      certificateFingerprint: "dev_fingerprint",
      certificateValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE auditor_public_keys SET is_active = false WHERE auditor_id = $1",
      [req.user.id]
    );
    const result = await client.query(
      `INSERT INTO auditor_public_keys
         (key_id, auditor_id, public_key_spki, certificate_pem, certificate_fingerprint, certificate_valid_until, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (key_id) DO UPDATE SET
         public_key_spki = EXCLUDED.public_key_spki,
         certificate_pem = EXCLUDED.certificate_pem,
         certificate_fingerprint = EXCLUDED.certificate_fingerprint,
         certificate_valid_until = EXCLUDED.certificate_valid_until,
         is_active = true
       WHERE auditor_public_keys.auditor_id = EXCLUDED.auditor_id
       RETURNING key_id`,
      [
        validated.keyId,
        req.user.id,
        validated.publicKeySpki,
        req.body.certificatePem,
        validated.certificateFingerprint,
        validated.certificateValidUntil,
      ]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This key identifier is already registered to another auditor." });
    }
    await client.query("COMMIT");
    return res.status(201).json({ keyId: validated.keyId, validUntil: validated.certificateValidUntil });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register auditor public key error:", error);
    return res.status(500).json({ error: "Could not register the auditor public key." });
  } finally {
    client.release();
  }
});

export default router;