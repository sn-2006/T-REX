import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";

export default function AuditorProfile({ auditorId }) {
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
    return <main className="dashboard-main">Loading auditor...</main>;
  }

  if (error && !auditor) {
    return (
      <main className="dashboard-main">
        <button onClick={() => (window.location.hash = "#/taxpayer/auditors")}>
          ← Back
        </button>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main className="dashboard-main">
      <section className="dashboard-section">
        <button
          type="button"
          onClick={() => (window.location.hash = "#/taxpayer/auditors")}
        >
          ← Back to Auditors
        </button>

        <h1>{auditor.name}</h1>
        <p>Auditor ID: {auditor.auditorId}</p>
        <p>Status: {auditor.availability}</p>

        <hr />

        <h2>Request this auditor</h2>
        <p>
          Explain what you need help with. The auditor can review your request
          and choose whether to accept it.
        </p>

        <form onSubmit={handleRequest}>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Describe your tax/reconciliation issue..."
            rows={6}
            maxLength={5000}
          />

          <button type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send Request"}
          </button>
        </form>

        {message && <p>{message}</p>}
        {error && <p>{error}</p>}
      </section>
    </main>
  );
}
