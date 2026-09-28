import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function PreviousCARecords({ session, onLogout }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadRecords() {
      try {
        const data = await apiFetch("/auditor-requests/my");
        // Show only inactive/past requests (Rejected) as previous records.
        // Active (Accepted) and Pending requests belong in other active views.
        const historical = data.filter((req) => req.status === "Rejected" || req.status === "Closed");
        setRecords(historical);
      } catch (err) {
        setError(err.message || "Couldn't load previous CA records.");
      } finally {
        setLoading(false);
      }
    }

    loadRecords();
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
            style={{ marginBottom: "24px" }}
          >
            ← Back to Dashboard
          </button>

          <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "var(--paper)" }}>
            Previous CA Records
          </h1>
          <p className="muted" style={{ marginBottom: "24px" }}>
            View your inactive or past relationships with Chartered Accountants.
          </p>

          {loading && <p className="muted">Loading records...</p>}

          {error && <div className="error">{error}</div>}

          {!loading && !error && records.length === 0 && (
            <p className="muted">You have no previous CA records.</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {records.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: "16px",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>{r.auditor_name}</h3>
                  <div style={{ fontSize: "14px", color: "var(--paper)", marginBottom: "4px" }}>
                    <span className="muted">Request Reason:</span> {r.reason}
                  </div>
                  <span className="muted" style={{ fontSize: "12px" }}>
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: "bold",
                      border: "1px solid",
                      borderColor: r.status === "Rejected" ? "#ff9b9b" : r.status === "Closed" ? "var(--muted)" : "var(--green)",
                      color: r.status === "Rejected" ? "#ff9b9b" : r.status === "Closed" ? "var(--muted)" : "var(--green)",
                    }}
                  >
                    {r.status.toUpperCase()}
                  </span>
                  {r.status === "Accepted" && (
                    <button
                      className="primary-btn"
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => {
                        window.location.hash = "#/taxpayer/conversations";
                      }}
                    >
                      View Conversation
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
