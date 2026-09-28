import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import DashboardHeader from "../components/DashboardHeader";

export default function AuditorConversation({ conversationId, session, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function loadMessages() {
    try {
      setError("");

      const data = await apiFetch(
        `/conversations/${conversationId}/messages`
      );

      setMessages(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
  }, [conversationId]);

  async function sendMessage(event) {
    event.preventDefault();

    if (!text.trim()) return;

    setSending(true);
    setError("");

    try {
      const newMessage = await apiFetch(
        `/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            message: text.trim(),
          },
        }
      );

      setMessages((current) => [
        ...current, 
        { 
          ...newMessage, 
          sender_role: session?.user?.role || "auditor", 
          sender_name: session?.user?.name || "Auditor" 
        }
      ]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="app app-wide">
        <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />
        <main className="app-main">
          <section className="card">
            <p>Loading conversation...</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />
      <main className="app-main">
      <section className="card">
        <button
          className="link-btn"
          type="button"
          onClick={() => {
            window.location.hash = "#/auditor";
          }}
          style={{ marginBottom: "16px" }}
        >
          ← Back to Auditor Dashboard
        </button>

        <div style={{ display: "flex", flexDirection: "column", height: "65vh" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "16px", marginBottom: "16px" }}>
            <div>
              <h1 style={{ margin: "0 0 4px 0", fontSize: "24px", color: "var(--paper)" }}>Private Conversation</h1>
              <span className="muted" style={{ fontSize: "14px" }}>Client Chat / Active</span>
            </div>
            <span className="muted" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
              🔒 Confidential
            </span>
          </div>

          {error && <div className="error">{error}</div>}

        <div className="conversation-messages" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "8px", minHeight: "50vh" }}>
          {messages.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", marginTop: "20px" }}>
              No messages yet. Start the conversation below.
            </p>
          ) : (
            messages.map((message) => {
              const isMine = message.sender_role === "auditor";
              return (
                <div key={message.id} style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isMine ? "flex-end" : "flex-start",
                  marginBottom: "8px"
                }}>
                  <div style={{
                    background: isMine ? "rgba(124, 151, 116, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    border: `1px solid ${isMine ? "var(--green)" : "var(--line)"}`,
                    padding: "12px 16px",
                    borderRadius: isMine ? "12px 12px 0 12px" : "12px 12px 12px 0",
                    maxWidth: "75%",
                  }}>
                    {!isMine && (
                      <strong style={{ color: "var(--green)", display: "block", marginBottom: "4px", fontSize: "12px" }}>
                        {message.sender_name || "Client"}
                      </strong>
                    )}
                    <p style={{ margin: "0 0 4px 0", color: "var(--paper)", whiteSpace: "pre-wrap" }}>{message.message}</p>
                    <small className="muted" style={{ fontSize: "10px", display: "block", textAlign: "right" }}>
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={sendMessage} style={{ marginTop: "24px", display: "flex", gap: "12px", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write a message to the taxpayer..."
            maxLength={5000}
            style={{ 
              flex: 1, 
              background: "#080a09", 
              border: "1px solid var(--line)", 
              color: "var(--paper)", 
              padding: "12px 16px", 
              borderRadius: "24px",
              font: '400 14px "DM Mono", monospace',
              outline: "none"
            }}
          />
          <button type="submit" className="primary-btn" disabled={sending || !text.trim()} style={{ borderRadius: "24px", padding: "0 24px" }}>
            {sending ? "..." : "Send"}
          </button>
        </form>
        </div>
      </section>
    </main>
    </div>
  );
}