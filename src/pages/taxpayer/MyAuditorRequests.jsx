import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function MyAuditorRequests({ session, onLogout }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadRequests() {
      try {
        const data = await apiFetch("/auditor-requests/my");
        const unique = [];
        const seen = new Set();
        for (const r of data) {
          if (!seen.has(r.auditor_id)) {
            seen.add(r.auditor_id);
            unique.push(r);
          }
        }
        setRequests(unique);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
      <main className="app-main">
      <section className="card">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => (window.location.hash = "#/taxpayer")}
        >
          ← Back to Dashboard
        </button>

        <h1>My Auditor Requests</h1>

        {loading && <p>Loading requests...</p>}

        {error && <p>{error}</p>}

        {!loading && !error && requests.length === 0 && (
          <p>You haven't requested an auditor yet.</p>
        )}

        {!loading && !error && requests.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            {requests.map((request) => (
              <article key={request.id} style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                padding: "16px", 
                background: "rgba(255,255,255,0.02)",
                border: "1px solid var(--line)",
                borderRadius: "8px"
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                    <h3 style={{ margin: 0, fontSize: "16px" }}>{request.auditor_name}</h3>
                    <span style={{ 
                      fontSize: "11px", 
                      padding: "2px 6px", 
                      borderRadius: "4px",
                      background: request.status === "Accepted" ? "rgba(124, 151, 116, 0.2)" : request.status === "Rejected" ? "rgba(255, 0, 0, 0.1)" : "rgba(255, 255, 255, 0.1)",
                      color: request.status === "Accepted" ? "var(--green)" : "var(--muted)",
                      border: `1px solid ${request.status === "Accepted" ? "var(--green)" : "var(--line)"}`
                    }}>
                      {request.status}
                    </span>
                    {request.pending_close && (
                       <span style={{ fontSize: "11px", color: "var(--orange)", padding: "2px 6px", border: "1px solid var(--orange)", borderRadius: "4px" }}>
                         Pending Closure (closes at {new Date(request.close_scheduled_at).toLocaleString()})
                       </span>
                    )}
                  </div>
                  <p className="muted" style={{ margin: "0 0 6px 0", fontSize: "13px" }}>{request.reason}</p>
                  <small className="muted" style={{ fontSize: "11px" }}>
                    {new Date(request.created_at).toLocaleString()}
                  </small>
                </div>

                {request.status === "Accepted" && (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="primary-btn"
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => (window.location.hash = "#/taxpayer/conversations")}
                    >
                      Open Chat
                    </button>
                    {!request.pending_close ? (
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: "6px 12px", fontSize: "12px" }}
                        onClick={async () => {
                          if (window.confirm("Request to close this engagement?")) {
                            try {
                              await apiFetch(`/auditor-requests/${request.id}/request-close`, { method: "PATCH" });
                              window.location.reload();
                            } catch(e) { alert(e.message); }
                          }
                        }}
                      >
                        Request Close
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-btn danger"
                        style={{ padding: "6px 12px", fontSize: "12px" }}
                        onClick={async () => {
                          if (window.confirm("Dispute closure?")) {
                            try {
                              await apiFetch(`/auditor-requests/${request.id}/dispute`, { method: "PATCH" });
                              window.location.reload();
                            } catch(e) { alert(e.message); }
                          }
                        }}
                      >
                        Raise Dispute
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
    </div>
  );
}
