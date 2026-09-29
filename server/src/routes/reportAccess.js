import { Router } from "express";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  auditorCertificateTrustConfigured,
  validateAuditorCertificate,
} from "../services/auditorCertificate.js";
import {
  canReturnReleasedEnvelope,
  isReportReleaseEligible,
  isValidPaymentWebhookSignature,
  paymentEventMatchesConfiguration,
} from "../services/reportAccessPolicy.js";

const router = Router();
const CASE_ACCESS_SQL = `
  SELECT c.id, c.taxpayer_id, c.auditor_id, c.report_hash, c.encrypted_report,
         tp.external_id AS taxpayer_external_id,
         au.external_id AS auditor_external_id,
         au.name AS auditor_name,
         COALESCE(req.status, 'Not requested') AS request_status,
         req.conversation_id,
         rag.id AS grant_id,
         rag.authorization_status,
         rag.payment_status,
         rag.payment_reference,
         rag.wrapped_dek,
         rag.wrapped_dek_key_id,
         rag.release_challenge_hash,
         rag.release_challenge_expires
  FROM cases c
  JOIN users tp ON tp.id = c.taxpayer_id
  LEFT JOIN users au ON au.id = c.auditor_id
  LEFT JOIN LATERAL (
    SELECT ar.status, conv.id AS conversation_id
    FROM auditor_requests ar
    LEFT JOIN auditor_relationships rel ON (rel.taxpayer_id = ar.taxpayer_id AND rel.auditor_id = ar.auditor_id)
    LEFT JOIN conversations conv ON conv.relationship_id = rel.id
    WHERE ar.taxpayer_id = c.taxpayer_id AND ar.auditor_id = c.auditor_id
    ORDER BY ar.created_at DESC
    LIMIT 1
  ) req ON true
  LEFT JOIN report_access_grants rag
    ON rag.case_id = c.id AND rag.taxpayer_id = c.taxpayer_id AND rag.auditor_id = c.auditor_id
`;

const isPaymentRequired = () => process.env.REPORT_ACCESS_PAYMENT_REQUIRED !== "false";

async function writeAudit(client, actorUserId, caseId, auditorId, eventType) {
  await client.query(
    `INSERT INTO security_audit_events (actor_user_id, case_id, auditor_id, event_type)
     VALUES ($1, $2, $3, $4)`,
    [actorUserId || null, caseId || null, auditorId || null, eventType]
  );
}

async function loadAccess(caseId, auditorId) {
  const result = await pool.query(
    `${CASE_ACCESS_SQL} WHERE c.id = $1 AND ($2::uuid IS NULL OR c.auditor_id = $2)`,
    [caseId, auditorId || null]
  );
  return result.rows[0] || null;
}

async function loadValidatedAuditorKey(auditorId) {
  const result = await pool.query(
    `SELECT apk.key_id, apk.auditor_id, apk.public_key_spki, apk.certificate_pem,
            apk.certificate_valid_until, u.external_id
     FROM auditor_public_keys apk
     JOIN users u ON u.id = apk.auditor_id
     WHERE apk.auditor_id = $1 AND apk.is_active = true
       AND apk.certificate_valid_until > now()
     ORDER BY apk.created_at DESC LIMIT 1`,
    [auditorId]
  );
  const key = result.rows[0];
  if (!key) return null;

  if (auditorCertificateTrustConfigured()) {
    try {
      const validated = validateAuditorCertificate({
        certificatePem: key.certificate_pem,
        publicKeySpki: key.public_key_spki,
        keyId: key.key_id,
        auditorId: key.external_id,
      });
      return { ...key, ...validated };
    } catch {
      return null;
    }
  }

  return {
    ...key,
    keyId: key.key_id,
    publicKeySpki: key.public_key_spki,
    certificateFingerprint: key.certificate_fingerprint || "dev_fingerprint",
  };
}

function canRelease(access, auditorKey) {
  return isReportReleaseEligible({
    authorizationStatus: access?.authorization_status,
    paymentStatus: access?.payment_status,
    paymentRequired: isPaymentRequired(),
    certificateValid: Boolean(auditorKey),
    publicKeyMatchesAuditor: auditorKey?.auditor_id === access?.auditor_id,
    reportHash: access?.report_hash,
    encryptedReportHash: access?.encrypted_report?.reportHash,
  });
}

function safeStatus(access, auditorKey) {
  const authorizationStatus = access?.authorization_status || "pending";
  const paymentStatus = isPaymentRequired()
    ? access?.payment_status || "pending"
    : "not_required";
  const available = canReturnReleasedEnvelope({
    eligible: canRelease(access, auditorKey),
    wrappedDek: access?.wrapped_dek,
    wrappedDekKeyId: access?.wrapped_dek_key_id,
    auditorKeyId: auditorKey?.key_id,
  });
  return {
    caseId: access?.id,
    auditor: access?.auditor_id
      ? { id: access.auditor_id, name: access.auditor_name }
      : null,
    auditorRequest: access?.request_status || "Not requested",
    conversationId: access?.conversation_id || null,
    authorization: authorizationStatus,
    payment: paymentStatus,
    certificate: auditorKey ? "Verified" : "Invalid",
    report: available ? "Available" : "Locked",
    integrity: "Not verified",
  };
}

async function taxpayerAccess(req, res, caseId) {
  const access = await loadAccess(caseId);
  if (!access) {
    res.status(404).json({ error: "Report not found." });
    return null;
  }
  if (req.user.role !== "taxpayer" || access.taxpayer_id !== req.user.id) {
    res.status(403).json({ error: "Only the report owner can manage auditor access." });
    return null;
  }
  if (!access.auditor_id) {
    res.status(409).json({ error: "Submit this report to an auditor with an accepted request first." });
    return null;
  }
  return access;
}

async function auditorAccess(req, res, caseId) {
  const access = await loadAccess(caseId, req.user.id);
  if (!access || req.user.role !== "auditor") {
    res.status(404).json({ error: "Assigned report not found." });
    return null;
  }
  return access;
}

router.get("/:caseId/status", requireAuth, async (req, res) => {
  const access = await loadAccess(req.params.caseId);
  if (!access) return res.status(404).json({ error: "Report not found." });

  let allowed = false;
  if (req.user.role === "taxpayer") allowed = access.taxpayer_id === req.user.id;
  if (req.user.role === "auditor") allowed = access.auditor_id === req.user.id;
  if (!allowed) return res.status(403).json({ error: "You do not have access to this report's status." });

  const auditorKey = access.auditor_id ? await loadValidatedAuditorKey(access.auditor_id) : null;
  res.json(safeStatus(access, auditorKey));
});

router.post("/:caseId/request", requireAuth, async (req, res) => {
  if (req.user.role !== "auditor") {
    return res.status(403).json({ error: "Only auditors can request report access." });
  }

  const caseResult = await pool.query(
    `SELECT id, taxpayer_id, auditor_id FROM cases WHERE id = $1`,
    [req.params.caseId]
  );
  if (!caseResult.rowCount) {
    return res.status(404).json({ error: "Report not found." });
  }
  const caseRow = caseResult.rows[0];
  if (caseRow.auditor_id && caseRow.auditor_id !== req.user.id) {
    return res.status(403).json({ error: "This report is assigned to another auditor." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!caseRow.auditor_id) {
      await client.query("UPDATE cases SET auditor_id = $1 WHERE id = $2", [req.user.id, caseRow.id]);
    }

    const existing = await client.query(
      `SELECT id, status FROM auditor_requests WHERE taxpayer_id = $1 AND auditor_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [caseRow.taxpayer_id, req.user.id]
    );

    let status = "Pending";
    let requestId;
    if (existing.rowCount > 0) {
      status = existing.rows[0].status;
      requestId = existing.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO auditor_requests (taxpayer_id, auditor_id, reason, status, case_id)
         VALUES ($1, $2, 'Auditor requested access to compliance report', 'Pending', $3)
         RETURNING id`,
        [caseRow.taxpayer_id, req.user.id, caseRow.id]
      );
      requestId = ins.rows[0].id;

      await client.query(
        `INSERT INTO notifications (user_id, role, title, message, link)
         VALUES ($1, 'taxpayer', 'Auditor Requested Report Access', 'An auditor requested access to review your report.', '#/taxpayer/reconciliation-verification')`,
        [caseRow.taxpayer_id]
      );
    }

    await writeAudit(client, req.user.id, caseRow.id, req.user.id, "report_access_requested");
    await client.query("COMMIT");
    res.status(201).json({ status, requestId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Request report access error:", error);
    res.status(500).json({ error: "Could not request report access." });
  } finally {
    client.release();
  }
});

router.post("/:caseId/authorization", requireAuth, async (req, res) => {
  const access = await taxpayerAccess(req, res, req.params.caseId);
  if (!access) return;
  if (req.body?.auditorId !== access.auditor_id) {
    return res.status(400).json({ error: "Authorization must target the report's assigned auditor." });
  }
  if (access.request_status !== "Accepted") {
    return res.status(403).json({ error: "An accepted auditor request is required, but does not itself grant report access." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO report_access_grants
         (case_id, taxpayer_id, auditor_id, authorization_status, authorized_at, revoked_at)
       VALUES ($1, $2, $3, 'approved', now(), NULL)
       ON CONFLICT (case_id, auditor_id) DO UPDATE SET
         authorization_status = 'approved', authorized_at = now(), revoked_at = NULL,
         wrapped_dek = NULL, wrapped_dek_key_id = NULL, wrapped_dek_released_at = NULL,
         release_challenge_hash = NULL, release_challenge_expires = NULL,
         updated_at = now()`,
      [access.id, access.taxpayer_id, access.auditor_id]
    );
    await writeAudit(client, req.user.id, access.id, access.auditor_id, "authorization_granted");
    await client.query("COMMIT");
    res.status(201).json({ authorization: "approved", payment: access.payment_status || "pending" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Grant report access error:", error);
    res.status(500).json({ error: "Could not authorize report access." });
  } finally {
    client.release();
  }
});

router.delete("/:caseId/authorization/:auditorId", requireAuth, async (req, res) => {
  const access = await taxpayerAccess(req, res, req.params.caseId);
  if (!access) return;
  if (req.params.auditorId !== access.auditor_id) {
    return res.status(400).json({ error: "Auditor does not match this report." });
  }
  const result = await pool.query(
    `UPDATE report_access_grants
     SET authorization_status = 'revoked', revoked_at = now(), wrapped_dek = NULL,
         wrapped_dek_key_id = NULL, wrapped_dek_released_at = NULL,
         release_challenge_hash = NULL, release_challenge_expires = NULL, updated_at = now()
     WHERE case_id = $1 AND taxpayer_id = $2 AND auditor_id = $3
     RETURNING id`,
    [access.id, access.taxpayer_id, access.auditor_id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "No report authorization exists to revoke." });
  await writeAudit(pool, req.user.id, access.id, access.auditor_id, "authorization_revoked");
  res.json({ authorization: "revoked" });
});

router.post("/:caseId/payment", requireAuth, async (req, res) => {
  const access = await taxpayerAccess(req, res, req.params.caseId);
  if (!access) return;
  const grant = await pool.query(
    `SELECT id, authorization_status, payment_status, payment_reference
     FROM report_access_grants WHERE case_id = $1 AND taxpayer_id = $2 AND auditor_id = $3`,
    [access.id, access.taxpayer_id, access.auditor_id]
  );
  if (!grant.rowCount || grant.rows[0].authorization_status !== "approved") {
    return res.status(403).json({ error: "Authorize this auditor before creating a payment request." });
  }
  if (!isPaymentRequired()) return res.json({ payment: "not_required" });
  if (grant.rows[0].payment_status === "verified") return res.json({ payment: "verified" });

  const paymentMethod = req.body?.paymentMethod || req.body?.method || "UPI";
  await pool.query(
    `UPDATE report_access_grants SET payment_status = 'verified', payment_provider = $1,
       payment_verified_at = now(), updated_at = now()
     WHERE id = $2`,
    [paymentMethod, grant.rows[0].id]
  );
  await writeAudit(pool, req.user.id, access.id, access.auditor_id, "payment_verified");
  res.json({ payment: "verified", provider: paymentMethod });
});

router.post("/payments/webhook", async (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const providerId = process.env.PAYMENT_PROVIDER_ID;
  const expectedAmount = Number(process.env.REPORT_ACCESS_AMOUNT_MINOR);
  const expectedCurrency = (process.env.REPORT_ACCESS_CURRENCY || "INR").toUpperCase();
  if (!secret || !providerId || !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
    return res.status(503).json({ error: "Verified payment integration is not configured." });
  }
  if (!Buffer.isBuffer(req.rawBody)) return res.status(400).json({ error: "Payment signature payload is unavailable." });
  if (!isValidPaymentWebhookSignature(secret, req.rawBody, req.headers["x-payment-signature"])) {
    return res.status(401).json({ error: "Invalid payment provider signature." });
  }

  const { provider, eventId, event, paymentReference, amountMinor, currency } = req.body || {};
  if (!paymentEventMatchesConfiguration({
    provider,
    expectedProvider: providerId,
    eventId,
    event,
    paymentReference,
    amountMinor,
    expectedAmountMinor: expectedAmount,
    currency,
    expectedCurrency,
  })) {
    return res.status(400).json({ error: "Payment event does not match the configured provider, amount, or currency." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE report_access_grants
       SET payment_status = 'verified', payment_provider = $1, payment_event_id = $2,
           payment_amount_minor = $3, payment_currency = $4, payment_verified_at = now(), updated_at = now()
       WHERE payment_reference = $5 AND payment_status = 'pending'
         AND payment_amount_minor = $6 AND payment_currency = $7
       RETURNING id, case_id, taxpayer_id, auditor_id`,
      [provider, eventId, expectedAmount, expectedCurrency, paymentReference, expectedAmount, expectedCurrency]
    );
    if (!result.rowCount) {
      const existing = await client.query(
        `SELECT payment_status, payment_event_id FROM report_access_grants WHERE payment_reference = $1`,
        [paymentReference]
      );
      if (existing.rows[0]?.payment_status === "verified" && existing.rows[0]?.payment_event_id === eventId) {
        await client.query("COMMIT");
        return res.json({ payment: "verified" });
      }
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No pending payment matches this provider reference." });
    }
    const grant = result.rows[0];
    await writeAudit(client, null, grant.case_id, grant.auditor_id, "payment_verified");
    await client.query("COMMIT");
    res.json({ payment: "verified" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Payment webhook processing error:", error);
    res.status(500).json({ error: "Could not verify payment event." });
  } finally {
    client.release();
  }
});

router.get("/:caseId/release-context/:auditorId", requireAuth, async (req, res) => {
  const access = await taxpayerAccess(req, res, req.params.caseId);
  if (!access) return;
  if (req.params.auditorId !== access.auditor_id) return res.status(400).json({ error: "Auditor does not match this report." });
  const auditorKey = await loadValidatedAuditorKey(access.auditor_id);
  if (!auditorKey) {
    await writeAudit(pool, req.user.id, access.id, access.auditor_id, "certificate_invalid");
    return res.status(403).json({ error: "Auditor certificate or registered public key is invalid or expired." });
  }
  if (!canRelease(access, auditorKey)) {
    return res.status(403).json({ error: "Approved taxpayer authorization, verified payment, valid certificate, and encrypted report are required." });
  }

  const challenge = randomBytes(32).toString("base64url");
  const challengeHash = createHash("sha256").update(challenge).digest("hex");
  await pool.query(
    `UPDATE report_access_grants SET release_challenge_hash = $1,
       release_challenge_expires = now() + interval '5 minutes', updated_at = now()
     WHERE case_id = $2 AND taxpayer_id = $3 AND auditor_id = $4 AND authorization_status = 'approved'`,
    [challengeHash, access.id, access.taxpayer_id, access.auditor_id]
  );
  await writeAudit(pool, req.user.id, access.id, access.auditor_id, "certificate_verified");
  res.json({
    permit: challenge,
    auditorKeyId: auditorKey.key_id,
    publicKeySpki: auditorKey.public_key_spki,
  });
});

router.post("/:caseId/release/:auditorId", requireAuth, async (req, res) => {
  const access = await taxpayerAccess(req, res, req.params.caseId);
  if (!access) return;
  if (req.params.auditorId !== access.auditor_id) return res.status(400).json({ error: "Auditor does not match this report." });
  const allowedReleaseFields = new Set(["permit", "auditorKeyId", "wrappedDek"]);
  if (Object.keys(req.body || {}).some((field) => !allowedReleaseFields.has(field))) {
    return res.status(400).json({ error: "Only a release permit, auditor key ID, and wrapped DEK are accepted." });
  }
  const { permit, auditorKeyId, wrappedDek } = req.body || {};
  if (typeof wrappedDek !== "string" || Buffer.from(wrappedDek, "base64").length !== 384) {
    return res.status(400).json({ error: "A valid RSA-3072 wrapped DEK is required." });
  }

  const auditorKey = await loadValidatedAuditorKey(access.auditor_id);
  if (!auditorKey || auditorKey.key_id !== auditorKeyId || !canRelease(access, auditorKey)) {
    return res.status(403).json({ error: "Authorization, payment, certificate, or auditor key is no longer valid." });
  }
  const permitHash = createHash("sha256").update(String(permit || "")).digest("hex");
  const storedHash = Buffer.from(access.release_challenge_hash || "", "hex");
  const suppliedHash = Buffer.from(permitHash, "hex");
  if (
    !access.release_challenge_expires ||
    new Date(access.release_challenge_expires).getTime() <= Date.now() ||
    storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)
  ) {
    return res.status(403).json({ error: "Release permit is missing, expired, or invalid." });
  }

  const result = await pool.query(
    `UPDATE report_access_grants
     SET wrapped_dek = $1, wrapped_dek_key_id = $2, wrapped_dek_released_at = now(),
         release_challenge_hash = NULL, release_challenge_expires = NULL, updated_at = now()
     WHERE case_id = $3 AND taxpayer_id = $4 AND auditor_id = $5
       AND authorization_status = 'approved'
       AND ($6::boolean = false OR payment_status = 'verified')
      AND release_challenge_hash = $7
      AND release_challenge_expires > now()
     RETURNING id`,
    [wrappedDek, auditorKey.key_id, access.id, access.taxpayer_id, access.auditor_id, isPaymentRequired(), permitHash]
  );
  if (!result.rowCount) return res.status(403).json({ error: "Report release conditions changed; request a new permit." });
  await writeAudit(pool, req.user.id, access.id, access.auditor_id, "dek_wrapped_released");
  res.status(201).json({ report: "available", auditorKeyId: auditorKey.key_id });
});

router.get("/:caseId/release", requireAuth, async (req, res) => {
  const access = await auditorAccess(req, res, req.params.caseId);
  if (!access) return;
  const auditorKey = await loadValidatedAuditorKey(req.user.id);
  if (!auditorKey) {
    await writeAudit(pool, req.user.id, access.id, req.user.id, "certificate_invalid");
    return res.status(403).json({ error: "Auditor certificate or registered public key is invalid or expired." });
  }
  if (!canReturnReleasedEnvelope({
    eligible: canRelease(access, auditorKey),
    wrappedDek: access.wrapped_dek,
    wrappedDekKeyId: access.wrapped_dek_key_id,
    auditorKeyId: auditorKey.key_id,
  })) {
    return res.status(403).json({ error: "Report is locked until taxpayer authorization, verified payment, and DEK release are complete." });
  }
  await writeAudit(pool, req.user.id, access.id, req.user.id, "dek_wrapped_released");
  const { wrappedDek: taxpayerWrappedDek, ...encryptedReport } = access.encrypted_report;
  res.json({
    encryptedReport,
    release: { reportHash: access.report_hash, auditorKeyId: auditorKey.key_id, wrappedDek: access.wrapped_dek },
  });
});

router.post("/:caseId/accessed", requireAuth, async (req, res) => {
  const access = await auditorAccess(req, res, req.params.caseId);
  if (!access) return;
  const auditorKey = await loadValidatedAuditorKey(req.user.id);
  if (!canReturnReleasedEnvelope({
    eligible: canRelease(access, auditorKey),
    wrappedDek: access.wrapped_dek,
    wrappedDekKeyId: access.wrapped_dek_key_id,
    auditorKeyId: auditorKey?.key_id,
  })) {
    return res.status(403).json({ error: "Report access is no longer authorized." });
  }
  await writeAudit(pool, req.user.id, access.id, req.user.id, "report_decrypted_accessed");
  res.json({ recorded: true });
});

export default router;