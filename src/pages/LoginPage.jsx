import { useState } from "react";
import { loginTaxpayer, loginAuditor, loginRegulator } from "../auth/auth";

const COPY = {
  taxpayer: {
    title: "Taxpayer login",
    blurb: "Sign in with your PAN to upload exchange statements and reconcile TDS.",
    hint: 'Demo: any PAN + name + a password of 4+ characters, e.g. PAN "ABCDE1234F".',
  },
  auditor: {
    title: "Auditor login",
    blurb: "Sign in with your auditor ID to review assigned taxpayer cases.",
    hint: "Demo auditor IDs: AUD001 or AUD002 · password: auditor123",
  },
  regulator: {
    title: "Government regulator login",
    blurb: "Sign in for read-only compliance analytics across all taxpayers.",
    hint: "Demo regulator ID: REG001 · password: regulator123",
  },
};

export default function LoginPage({ role, onLoggedIn }) {
  const copy = COPY[role];
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Taxpayer-only fields
  const [pan, setPan] = useState("");
  const [name, setName] = useState("");
  // Auditor / regulator fields
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let session;
      if (role === "taxpayer") {
        session = loginTaxpayer({ pan, name, password });
      } else if (role === "auditor") {
        session = loginAuditor({ id, password });
      } else {
        session = loginRegulator({ id, password });
      }
      onLoggedIn(session);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!copy) {
    return (
      <section className="card">
        <h1>Unknown login</h1>
        <a className="link-btn" href="#/">Back to role selection</a>
      </section>
    );
  }

  return (
    <section className="card login-card">
      <h1>{copy.title}</h1>
      <p className="muted">{copy.blurb}</p>

      <form className="login-form" onSubmit={handleSubmit}>
        {role === "taxpayer" ? (
          <>
            <label className="wallet-label">
              Full name
              <input
                className="name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rohit Sharma"
              />
            </label>
            <label className="wallet-label">
              PAN
              <input
                className="name-input"
                type="text"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
                placeholder="ABCDE1234F"
              />
            </label>
          </>
        ) : (
          <label className="wallet-label">
            {role === "auditor" ? "Auditor ID" : "Regulator ID"}
            <input
              className="name-input"
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={role === "auditor" ? "AUD001" : "REG001"}
            />
          </label>
        )}

        <label className="wallet-label">
          Password
          <input
            className="name-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="muted small login-hint">{copy.hint}</p>
      <a className="link-btn" href="#/">← Back to role selection</a>
    </section>
  );
}
