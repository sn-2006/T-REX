import { useState } from "react";
import { loginTaxpayer, loginAuditor, loginRegulator } from "../auth/auth";

const REGIONS = ["North", "South", "East", "West", "Central", "North-East"];

const COPY = {
  taxpayer: {
    number: "01",
    roleName: "TAXPAYER",
    title: "TAXPAYER ACCESS",
    blurb: "Sign in with your PAN to upload exchange statements, reconcile Section 194S TDS, and anchor reports.",
    hint: 'Demo: any PAN + name + region + email + a password of 4+ characters, e.g. PAN "ABCDE1234F".',
  },
  auditor: {
    number: "02",
    roleName: "AUDITOR",
    title: "AUDITOR ACCESS",
    blurb: "Sign in with your verified Auditor ID to review assigned taxpayer compliance cases.",
    hint: "Demo auditor IDs: AUD001 or AUD002 · password: auditor123",
  },
  regulator: {
    number: "03",
    roleName: "REGULATOR",
    title: "REGULATOR ACCESS",
    blurb: "Sign in for read-only sovereign compliance analytics, regional metrics, and exchange monitoring.",
    hint: "Demo regulator ID: REG001 · password: regulator123",
  },
};

function Arrow({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 10h13M10.5 4.5 16 10l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LoginPage({ role, onLoggedIn }) {
  const copy = COPY[role];
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Taxpayer-only fields
  const [pan, setPan] = useState("");
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [email, setEmail] = useState("");
  // Auditor / regulator fields
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let session;
      if (role === "taxpayer") {
        session = await loginTaxpayer({ pan, name, password, region, email });
      } else if (role === "auditor") {
        session = await loginAuditor({ id, password });
      } else {
        session = await loginRegulator({ id, password });
      }
      onLoggedIn(session);
    } catch (e) {
      setError(e.message);
      window.alert(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!copy) {
    return (
      <div className="login-page-wrap">
        <header className="login-nav">
          <button className="brand" onClick={() => (window.location.hash = "#/")}>
            <span className="brand-mark">T</span>
            <span>T-REX</span>
          </button>
          <a className="login-back-link" href="#/">
            ← BACK TO HOME
          </a>
        </header>
        <section className="card login-card">
          <h1>Unknown login portal</h1>
          <p className="muted">Please choose a valid role to access T-REX.</p>
          <a className="primary-btn" href="#/">
            RETURN TO LANDING PAGE <Arrow />
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <header className="login-nav">
        <button className="brand" onClick={() => (window.location.hash = "#/")}>
          <span className="brand-mark">T</span>
          <span>T-REX</span>
        </button>
        <a className="login-back-link" href="#/">
          ← RETURN TO HOME
        </a>
      </header>

      <main className="login-main">
        <div className="login-container">
          <div className="section-tag">
            <span>{copy.number}</span>
            <span>PORTAL AUTHENTICATION</span>
          </div>

          <h1 className="login-heading">
            {copy.roleName}.
            <br />
            <em>PORTAL.</em>
          </h1>
          <p className="login-blurb">{copy.blurb}</p>

          <form className="login-form-box" onSubmit={handleSubmit}>
            {role === "taxpayer" ? (
              <>
                <div className="input-group">
                  <label className="mono-label">FULL NAME</label>
                  <input
                    className="mono-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rohit Sharma"
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="mono-label">PERMANENT ACCOUNT NUMBER (PAN)</label>
                  <input
                    className="mono-input"
                    type="text"
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F"
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="mono-label">TAX REGION / JURISDICTION</label>
                  <select
                    className="mono-input mono-select"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    required
                  >
                    <option value="">Select your registered region</option>
                    {REGIONS.map((r) => (
                      <option key={r} value={r}>
                        {r} Region
                      </option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label className="mono-label">OFFICIAL EMAIL ADDRESS</label>
                  <input
                    className="mono-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="taxpayer@domain.com"
                    required
                  />
                </div>

                <span className="micro-help">
                  First-time PAN registration will automatically initialize your decentralized compliance account.
                </span>
              </>
            ) : (
              <div className="input-group">
                <label className="mono-label">
                  {role === "auditor" ? "AUTHORIZED AUDITOR ID" : "GOVERNMENT REGULATOR ID"}
                </label>
                <input
                  className="mono-input"
                  type="text"
                  value={id}
                  onChange={(e) => setId(e.target.value.toUpperCase())}
                  placeholder={role === "auditor" ? "AUD001" : "REG001"}
                  required
                />
              </div>
            )}

            <div className="input-group">
              <label className="mono-label">ACCESS PASSWORD</label>
              <input
                className="mono-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </div>

            {error && (
              <div className="login-error-box">
                <span className="error-indicator">!</span>
                <span>{error}</span>
              </div>
            )}

            <button className="primary-btn login-submit-btn" type="submit" disabled={submitting}>
              {submitting ? "AUTHENTICATING..." : "ENTER PORTAL"} <Arrow />
            </button>
          </form>

          <div className="login-hint-strip">
            <div className="hint-label">SANDBOX CREDENTIALS</div>
            <div className="hint-content">{copy.hint}</div>
          </div>

          <div className="role-switch-row">
            <span className="switch-label">SWITCH PORTAL:</span>
            {role !== "taxpayer" && <a href="#/login/taxpayer">Taxpayer Portal</a>}
            {role !== "auditor" && <a href="#/login/auditor">Auditor Portal</a>}
            {role !== "regulator" && <a href="#/login/regulator">Regulator Portal</a>}
          </div>
        </div>
      </main>
    </div>
  );
}
