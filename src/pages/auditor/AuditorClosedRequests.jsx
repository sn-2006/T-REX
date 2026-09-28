import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function AuditorClosedRequests({ session, onLogout }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    try {
      const data = await apiFetch("/auditor-requests/incoming");
      // Only keep closed/rejected ones
      setRequests(data.filter(r => r.status === "Closed" || r.status === "Rejected"));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />
      <main className="app-main">
        <section className="card">
          <h1>Closed Requests</h1>
          <p className="muted">Your past engagements.</p>
          {error && <div className="error">{error}</div>}
          
          {requests.length === 0 ? (
            <div className="auditor-empty-state">No closed requests.</div>
          ) : (
            <div className="case-list">
              {requests.map((c) => (
                <div key={c.id} className="case-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{c.taxpayer_name}</strong>
                    <div className="muted small">{c.reason}</div>
                    {c.case_id && (
                      <div className="small" style={{ marginTop: "4px", color: "var(--green)", fontFamily: "monospace" }}>
                        Report SHA-256: {c.report_hash?.slice(0,16)}...{c.report_hash?.slice(-16)}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="case-status-pill">{c.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
