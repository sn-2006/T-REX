import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function AuditorDirectory({ session, onLogout }) {
  const [auditors, setAuditors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAuditors() {
      try {
        const data = await apiFetch("/auditors");
        setAuditors(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadAuditors();
  }, []);

  function openAuditor(auditorId) {
    window.location.hash = `#/taxpayer/auditors/${auditorId}`;
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
      <main className="app-main auditor-directory-page">
      <section className="card">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => (window.location.hash = "#/taxpayer")}
        >
          ← Back to Dashboard
        </button>

        <h1>Find an Auditor</h1>
        <p>Choose a registered auditor to request assistance with your tax reconciliation.</p>

        {loading && <p>Loading auditors...</p>}

        {error && <p>{error}</p>}

        {!loading && !error && auditors.length === 0 && (
          <p>No registered auditors are available yet.</p>
        )}

        {!loading && !error && auditors.length > 0 && (
          <div className="auditor-directory">
            {auditors.map((auditor) => (
              <article key={auditor.id} className="card" style={{ marginBottom: "16px" }}>
                <h2 style={{ fontSize: "24px", marginTop: "0" }}>{auditor.name}</h2>

                <p className="muted">Auditor ID: {auditor.auditorId}</p>
                <p className="muted">{auditor.availability}</p>

                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => openAuditor(auditor.id)}
                  style={{ marginTop: "16px" }}
                >
                  View Profile
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
    </div>
  );
}
