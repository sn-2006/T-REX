import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function AuditorChats({ session, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      const data = await apiFetch("/auditor-requests/incoming");
      // Only keep accepted/active ones
      setConversations(data.filter(r => r.status === "Accepted"));
    } catch (err) {
      setError(err.message);
    }
  }

  async function requestClose(requestId) {
    if (!window.confirm("Are you sure you want to request closing this engagement?")) return;
    try {
      await apiFetch(`/auditor-requests/${requestId}/request-close`, { method: "PATCH" });
      await loadConversations();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />
      <main className="app-main">
        <section className="card">
          <h1>Active Chats</h1>
          <p className="muted">Your active engagements with taxpayers.</p>
          {error && <div className="error">{error}</div>}
          
          {conversations.length === 0 ? (
            <div className="auditor-empty-state">No active chats.</div>
          ) : (
            <div className="case-list">
              {conversations.map((c) => (
                <div key={c.id} className="case-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{c.taxpayer_name}</strong>
                    <div className="muted small">{c.reason}</div>
                    {c.case_id && (
                      <div className="small" style={{ marginTop: "4px", color: "var(--green)", fontFamily: "monospace" }}>
                        Report SHA-256: {c.report_hash?.slice(0,16)}...{c.report_hash?.slice(-16)}
                      </div>
                    )}
                    {c.pending_close && (
                       <div className="muted small error">Pending closure (Closes at {new Date(c.close_scheduled_at).toLocaleString()})</div>
                    )}
                  </div>
                  <div>
                    {c.conversation_id && (
                      <button className="primary-btn" onClick={() => window.location.hash = `#/auditor/conversations/${c.conversation_id}`}>
                        Open Chat
                      </button>
                    )}
                    {!c.pending_close ? (
                      <button className="secondary-btn" onClick={() => requestClose(c.id)} style={{ marginLeft: 8 }}>
                        Request Close
                      </button>
                    ) : (
                      <button className="secondary-btn danger" onClick={async () => {
                          if (window.confirm("Dispute closure?")) {
                            try {
                              await apiFetch(`/auditor-requests/${c.id}/dispute`, { method: "PATCH" });
                              await loadConversations();
                            } catch(e) { alert(e.message); }
                          }
                      }} style={{ marginLeft: 8 }}>
                        Raise Dispute
                      </button>
                    )}
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
