import { useEffect, useState } from "react";
import { registerAuditorPublicKey } from "../api/auditorKeys.js";
import { getOrCreateClientKeyPair } from "../utils/reportCrypto.js";

export default function AuditorKeySetup({ session }) {
  const [keyPair, setKeyPair] = useState(null);
  const [certificatePem, setCertificatePem] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    getOrCreateClientKeyPair(`auditor:${session.id}`)
      .then((pair) => {
        if (!cancelled) setKeyPair(pair);
      })
      .catch((keyError) => {
        if (!cancelled) setError(keyError.message || "Could not create a local auditor key.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  async function handleRegister(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const result = await registerAuditorPublicKey({ keyPair, certificatePem });
      setSuccess(`Validated public key registered: ${result.keyId}`);
    } catch (registrationError) {
      setError(registrationError.message || "Could not register the public key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Auditor encryption key</h2>
      <p className="muted">The private key is non-exportable and remains in this browser.</p>
      <p className="muted">
        Certificate registration requires a deployment-configured external CA root and auditor identity mapping. Self-signed certificates are not accepted.
      </p>
      {loading && <p className="muted">Preparing local key...</p>}
      {keyPair && (
        <form onSubmit={handleRegister} style={{ display: "grid", gap: 12 }}>
          <label className="field-label">
            Key identifier
            <input value={keyPair.keyId} readOnly />
          </label>
          <label className="field-label">
            Public key (SPKI, base64)
            <textarea value={keyPair.publicKeySpki} readOnly rows={3} />
          </label>
          <label className="field-label">
            External CA certificate (PEM)
            <textarea
              value={certificatePem}
              onChange={(event) => setCertificatePem(event.target.value)}
              rows={5}
              spellCheck="false"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="secondary-btn" disabled={saving || !certificatePem.trim()}>
            {saving ? "Validating..." : "Register validated public key"}
          </button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="status">{success}</p>}
    </section>
  );
}