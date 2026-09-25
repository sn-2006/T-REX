import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";

export default function AuditorDirectory() {
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
    <main className="dashboard-main auditor-directory-page">
      <section className="dashboard-section">
        <button
          type="button"
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
              <article key={auditor.id} className="auditor-card">
                <h2>{auditor.name}</h2>

                <p>Auditor ID: {auditor.auditorId}</p>
                <p>{auditor.availability}</p>

                <button
                  type="button"
                  onClick={() => openAuditor(auditor.id)}
                >
                  View Profile
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
