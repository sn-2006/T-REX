import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function AuditorIncomingRequests({ session, onLogout }) {
  const [auditorRequests, setAuditorRequests] = useState([]);
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    loadAuditorRequests();
  }, []);

  async function loadAuditorRequests() {
    try {
      const data = await apiFetch("/auditor-requests/incoming");
      setAuditorRequests(data.filter(r => r.status === "Pending"));
    } catch (err) {
      setRequestError(err.message);
    }
  }

  async function handleRequestAction(requestId, action) {
    try {
      setRequestError("");
      const result = await apiFetch(`/auditor-requests/${requestId}/${action}`, {
        method: "PATCH",
      });

      if (action === "accept" && result.conversationId) {
        window.location.hash = `#/auditor/conversations/${result.conversationId}`;
      } else {
        await loadAuditorRequests();
      }
    } catch (err) {
      setRequestError(err.message);
    }
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />
      <main className="app-main">
        <section className="card auditor-request-section">
          <div className="auditor-request-header">
            <div>
              <span className="section-kicker">AUDITOR WORKFLOW</span>
              <h1>Incoming Requests</h1>
              <p className="muted">Taxpayers who have requested your assistance.</p>
            </div>
            <span className="request-count">{auditorRequests.length}</span>
          </div>

          {requestError && <div className="error">{requestError}</div>}

          {auditorRequests.length === 0 ? (
            <div className="auditor-empty-state">No incoming auditor requests.</div>
          ) : (
            <div className="auditor-request-list">
              {auditorRequests.map((request) => (
                <article key={request.id} className="auditor-request-card">
                  <div>
                    <h3>{request.taxpayer_name}</h3>
                    <p><strong>Request:</strong> {request.reason}</p>
                    {request.case_id && (
                      <div style={{ marginTop: "12px", padding: "12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                        <p style={{ margin: "0 0 8px 0" }}><strong>Report Verification</strong></p>
                        <p style={{ margin: "0 0 4px 0", fontSize: "12px" }}><strong>SHA-256:</strong> <span style={{ fontFamily: "monospace", color: "var(--green)" }}>{request.report_hash}</span></p>
                        <p style={{ margin: "0 0 4px 0", fontSize: "12px" }}><strong>Sources:</strong> {request.exchanges?.join(", ")} {request.wallets?.length > 0 && `(+ ${request.wallets.length} wallets)`}</p>
                        <p style={{ margin: 0, fontSize: "12px" }}><strong>Discrepancies:</strong> {request.reconciliation?.discrepancies?.length || 0} found</p>
                      </div>
                    )}
                    <small className="muted" style={{ display: "block", marginTop: "8px" }}>{new Date(request.created_at).toLocaleString()}</small>
                  </div>
                  <div className="auditor-request-actions">
                    <button type="button" className="primary-btn" onClick={() => handleRequestAction(request.id, "accept")}>Accept</button>
                    <button type="button" className="secondary-btn" onClick={() => handleRequestAction(request.id, "reject")}>Reject</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
