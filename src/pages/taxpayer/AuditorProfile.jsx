import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function AuditorProfile({ auditorId, session, onLogout }) {
  const [auditor, setAuditor] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAuditor() {
      try {
        const auditors = await apiFetch("/auditors");
        const found = auditors.find((item) => item.id === auditorId);

        if (!found) {
          throw new Error("Auditor not found.");
        }

        setAuditor(found);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadAuditor();
  }, [auditorId]);

  async function handleRequest(event) {
    event.preventDefault();

    if (!reason.trim()) {
      setError("Please enter a reason for your request.");
      return;
    }

    setSending(true);
    setError("");
    setMessage("");

    try {
      await apiFetch("/auditor-requests", {
        method: "POST",
        body: {
          auditorId,
          reason: reason.trim(),
        },
      });

      setReason("");
      setMessage("Request sent successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="app app-wide">
        <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
        <main className="app-main"><p className="muted">Loading auditor...</p></main>
      </div>
    );
  }

  if (error && !auditor) {
    return (
      <div className="app app-wide">
        <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
        <main className="app-main">
          <section className="card">
            <button className="secondary-btn" onClick={() => (window.location.hash = "#/taxpayer/auditors")}>
              ← Back
            </button>
            <p className="error">{error}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
      <main className="app-main">
        <section className="card">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => (window.location.hash = "#/taxpayer/auditors")}
        >
          ← Back to Auditors
        </button>

        <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "var(--paper)" }}>
          {auditor.name}
        </h1>
        <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
          <p className="muted" style={{ margin: 0 }}>Auditor ID: {auditor.auditorId}</p>
          <p className="muted" style={{ margin: 0 }}>Status: <span style={{ color: "var(--green)" }}>{auditor.availability}</span></p>
        </div>

        <hr />

        <h2 style={{ fontSize: "18px", marginTop: "24px", marginBottom: "8px" }}>Request this auditor</h2>
        <p className="muted">
          Explain what you need help with. The auditor can review your request
          and choose whether to accept it.
        </p>

        <form onSubmit={handleRequest} style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
          <label className="field-label">
            Reason for request
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe your tax/reconciliation issue..."
              rows={6}
              maxLength={5000}
              style={{ background: '#080a09', border: '1px solid var(--line)', color: 'var(--paper)', padding: '12px', font: '400 14px "DM Mono", monospace', width: '100%', boxSizing: 'border-box' }}
            />
          </label>

          <button type="submit" className="primary-btn" disabled={sending} style={{ alignSelf: 'flex-start' }}>
            {sending ? "Sending..." : "Send Request"}
          </button>
        </form>

        {message && <p className="success" style={{ color: "var(--green)", marginTop: "16px" }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: "16px" }}>{error}</p>}
      </section>
    </main>
    </div>
  );
}
