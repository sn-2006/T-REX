import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";

export default function MyAuditorRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadRequests() {
      try {
        const data = await apiFetch("/auditor-requests/my");
        setRequests(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  return (
    <main className="dashboard-main">
      <section className="dashboard-section">
        <button
          type="button"
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
          <div className="auditor-requests">
            {requests.map((request) => (
              <article key={request.id} className="auditor-request-card">
                <h2>{request.auditor_name}</h2>

                <p>
                  <strong>Status:</strong> {request.status}
                </p>

                <p>
                  <strong>Reason:</strong> {request.reason}
                </p>

                <small>
                  Requested on{" "}
                  {new Date(request.created_at).toLocaleString()}
                </small>

                {request.status === "Accepted" && (
                  <button
                    type="button"
                    onClick={() =>
                      (window.location.hash = "#/taxpayer/conversations")
                    }
                  >
                    Open Conversation
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
