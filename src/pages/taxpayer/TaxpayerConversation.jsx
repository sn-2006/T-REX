import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import DashboardHeader from "../../components/DashboardHeader";

export default function TaxpayerConversation({ session, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadConversations() {
      try {
        const convs = await apiFetch("/conversations/my");
        const unique = [];
        const seen = new Set();
        for (const c of convs) {
          if (!seen.has(c.auditorId)) {
            seen.add(c.auditorId);
            unique.push(c);
          }
        }
        setConversations(unique);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadConversations();
  }, []);

  async function openConversation(conv) {
    setConversation(conv);
    setError("");
    setMessages([]);
    try {
      const data = await apiFetch(`/conversations/${conv.conversationId}/messages`);
      setMessages(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    if (!text.trim() || !conversation) return;

    setSending(true);
    setError("");

    try {
      const newMessage = await apiFetch(
        `/conversations/${conversation.conversationId}/messages`,
        {
          method: "POST",
          body: { message: text.trim() },
        }
      );

      setMessages((current) => [
        ...current, 
        { 
          ...newMessage, 
          sender_role: session?.user?.role || "taxpayer", 
          sender_name: session?.user?.name || "Taxpayer" 
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
        <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
        <main className="app-main"><section className="card">Loading conversations...</section></main>
      </div>
    );
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
      <main className="app-main">
      <section className="card">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            if (conversation) {
              setConversation(null);
            } else {
              window.location.hash = "#/taxpayer/auditor-requests";
            }
          }}
          style={{ marginBottom: "24px" }}
        >
          {conversation ? "← Back to Active CAs" : "← Back to Requests"}
        </button>

        {error && !conversation && <p>{error}</p>}

        {!conversation ? (
          <>
            <h1>Active Conversations</h1>
            <p className="muted">Select a Chartered Accountant to view your conversation.</p>
            {conversations.length === 0 && !error && (
              <p>You don't have any active auditor relationships yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", marginTop: "24px" }}>
              {conversations.map((c) => (
                <div key={c.conversationId} style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center",
                  borderBottom: "1px solid var(--line)", 
                  padding: "16px 0" 
                }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "18px" }}>{c.auditorName}</h3>
                    <span style={{ fontSize: "12px", color: "var(--green)", border: "1px solid var(--green)", padding: "2px 6px", borderRadius: "4px" }}>Active Auditor</span>
                  </div>
                  <button className="primary-btn" style={{ padding: "8px 16px", fontSize: "12px" }} onClick={() => openConversation(c)}>
                    Open Chat
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "65vh" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "16px", marginBottom: "16px" }}>
              <div>
                <h1 style={{ margin: "0 0 4px 0", fontSize: "24px", color: "var(--paper)" }}>{conversation.auditorName}</h1>
                <span className="muted" style={{ fontSize: "14px" }}>Active Auditor</span>
              </div>
              <span className="muted" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                🔒 Confidential
              </span>
            </div>

            <div className="conversation-messages" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "8px" }}>
              {messages.length === 0 && (
                <p className="muted" style={{ textAlign: "center", marginTop: "20px" }}>No messages yet. Start the conversation below.</p>
              )}

              {messages.map((message) => {
                const isMine = message.sender_role === "taxpayer";
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
                          {message.sender_name || "Auditor"}
                        </strong>
                      )}
                      <p style={{ margin: "0 0 4px 0", color: "var(--paper)", whiteSpace: "pre-wrap" }}>{message.message}</p>
                      <small className="muted" style={{ fontSize: "10px", display: "block", textAlign: "right" }}>
                        {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={sendMessage} style={{ marginTop: "24px", display: "flex", gap: "12px", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Type your message..."
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

            {error && <p style={{ marginTop: "12px" }} className="error">{error}</p>}
          </div>
        )}
      </section>
    </main>
    </div>
  );
}
