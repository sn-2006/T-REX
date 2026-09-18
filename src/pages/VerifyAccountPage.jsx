import { useState } from "react";
import {
  sendEmailOtp,
  verifyEmailOtp,
  submitKyc,
} from "../api/verification";

const ID_TYPES = [
  { value: "PAN", label: "PAN" },
  { value: "AADHAAR", label: "Aadhaar" },
];

export default function VerifyAccountPage({ status, onStatusChange }) {
  const { email, emailVerified, kycStatus, kycLatestSubmission } = status;

  return (
    <section className="card">
      <h1>Verify your account</h1>
      <p className="muted">
        T-REX verifies every taxpayer's email and identity before a report can be
        generated — this keeps the audit trail tied to a real, confirmed person. Both
        steps take a minute.
      </p>
      <p className="muted small">
        Email is confirmed with a real one-time code sent to your inbox. KYC is checked
        against Aadhaar's official checksum and PAN's format rules, plus a live provider
        check when one is configured — see the KYC step below for exactly what that
        means for you.
      </p>

      <div className="verify-steps">
        <EmailStep
          email={email}
          emailVerified={emailVerified}
          emailConfigured={status.emailConfigured}
          onStatusChange={onStatusChange}
        />
        <KycStep
          kycStatus={kycStatus}
          latestSubmission={kycLatestSubmission}
          kycProviderConfigured={status.kycProviderConfigured}
          onStatusChange={onStatusChange}
        />
      </div>

      {emailVerified && kycStatus === "verified" && (
        <div className="action-banner action-banner-below">
          ✓ Both steps complete — you're all set. Head to the Upload tab to start a
          reconciliation.
        </div>
      )}
    </section>
  );
}

function EmailStep({ email: initialEmail, emailVerified, emailConfigured, onStatusChange }) {
  const [email, setEmail] = useState(initialEmail || "");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [devOtp, setDevOtp] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(!emailVerified);

  async function handleSend() {
    setError("");
    setSubmitting(true);
    try {
      const result = await sendEmailOtp(email);
      setSent(true);
      setDevOtp(result.devOtp || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    setError("");
    setSubmitting(true);
    try {
      await verifyEmailOtp(otp);
      setEditing(false);
      setSent(false);
      setOtp("");
      await onStatusChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="verify-step-card">
      <div className="verify-step-header">
        <h3>1. Verify your email</h3>
        {emailVerified && !editing && <span className="verify-badge verify-badge-ok">✓ Verified</span>}
      </div>
      {!emailConfigured && (
        <p className="muted small">
          Demo mode — no real SMTP is configured, so codes show up right here instead of
          your inbox.
        </p>
      )}

      {emailVerified && !editing ? (
        <>
          <p className="muted small">{initialEmail}</p>
          <button className="link-btn" onClick={() => setEditing(true)}>
            Use a different email
          </button>
        </>
      ) : (
        <>
          <label className="wallet-label">
            Email
            <input
              className="name-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <button className="secondary-btn" onClick={handleSend} disabled={submitting || !email}>
            {submitting && !sent ? "Sending..." : sent ? "Resend code" : "Send code"}
          </button>

          {sent && (
            <>
              {devOtp && (
                <p className="muted small verify-dev-otp">
                  Demo mode — no real email is sent, so here's your code: <strong>{devOtp}</strong>
                </p>
              )}
              <label className="wallet-label">
                Verification code
                <input
                  className="name-input"
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                />
              </label>
              <button className="primary-btn" onClick={handleVerify} disabled={submitting || !otp}>
                {submitting ? "Verifying..." : "Verify email"}
              </button>
            </>
          )}

          {error && <div className="error small">{error}</div>}
        </>
      )}
    </div>
  );
}

function KycStep({ kycStatus, latestSubmission, kycProviderConfigured, onStatusChange }) {
  const [fullName, setFullName] = useState(latestSubmission?.full_name || "");
  const [dob, setDob] = useState(
    latestSubmission?.dob ? String(latestSubmission.dob).slice(0, 10) : ""
  );
  const [idType, setIdType] = useState(latestSubmission?.id_type || "PAN");
  const [idNumber, setIdNumber] = useState(latestSubmission?.id_number || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reasons, setReasons] = useState(latestSubmission?.rejection_reasons || []);
  const [editing, setEditing] = useState(kycStatus !== "verified");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setReasons([]);
    setSubmitting(true);
    try {
      const result = await submitKyc({ fullName, dob, idType, idNumber });
      if (result.status === "verified") {
        setEditing(false);
      } else {
        setReasons(result.reasons || []);
      }
      await onStatusChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="verify-step-card">
      <div className="verify-step-header">
        <h3>2. Complete KYC</h3>
        {kycStatus === "verified" && !editing && (
          <span className="verify-badge verify-badge-ok">✓ Verified</span>
        )}
        {kycStatus === "rejected" && (
          <span className="verify-badge verify-badge-fail">Needs another look</span>
        )}
      </div>
      <p className="muted small">
        {kycProviderConfigured
          ? "PAN is checked against a live verification provider; Aadhaar is checked against its official checksum."
          : "No live verification provider is configured — PAN is checked by format only, Aadhaar by its official checksum. Ask an admin to set KYC_PROVIDER_API_KEY for provider-backed PAN checks."}
      </p>

      {kycStatus === "verified" && !editing ? (
        <>
          <p className="muted small">{fullName} · {idType} {idNumber}</p>
          <button className="link-btn" onClick={() => setEditing(true)}>
            Resubmit KYC
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <label className="wallet-label">
            Full legal name
            <input
              className="name-input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="As it appears on your ID"
            />
          </label>
          <label className="wallet-label">
            Date of birth
            <input
              className="name-input"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </label>
          <label className="field-label">
            ID type
            <select value={idType} onChange={(e) => setIdType(e.target.value)}>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="wallet-label">
            {idType === "PAN" ? "PAN number" : "Aadhaar number"}
            <input
              className="name-input"
              type="text"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder={idType === "PAN" ? "ABCDE1234F" : "12-digit number"}
            />
          </label>

          {reasons.length > 0 && (
            <div className="error small">
              <strong>Couldn't verify this submission:</strong>
              <ul>
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="error small">{error}</div>}

          <button className="primary-btn" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit KYC"}
          </button>
        </form>
      )}
    </div>
  );
}
