import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";

export default function TaxpayerConversation() {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function loadConversation() {
    try {
      const conversations = await apiFetch("/conversations/my");

      if (!conversations.length) {
        setError("You don't have an accepted auditor yet.");
        return;
      }

      const current = conversations[0];
      setConversation(current);

      const data = await apiFetch(
        `/conversations/${current.conversationId}/messages`
      );

      setMessages(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConversation();
  }, []);

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

      setMessages((current) => [...current, newMessage]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <main className="dashboard-main">Loading conversation...</main>;
  }

  return (
    <main className="dashboard-main">
      <section className="dashboard-section">
        <button
          type="button"
          onClick={() =>
            (window.location.hash = "#/taxpayer/auditor-requests")
          }
        >
          ← Back to Requests
        </button>

        {error && !conversation && <p>{error}</p>}

        {conversation && (
          <>
            <h1>Conversation with {conversation.auditorName}</h1>
            <p>Your conversation is accessible only to you and this auditor.</p>

            <div className="conversation-messages">
              {messages.length === 0 && (
                <p>No messages yet. Start the conversation below.</p>
              )}

              {messages.map((message) => (
                <div key={message.id} className="conversation-message">
                  <strong>{message.sender_name || "User"}</strong>
                  <p>{message.message}</p>
                  <small>
                    {new Date(message.created_at).toLocaleString()}
                  </small>
                </div>
              ))}
            </div>

            <form onSubmit={sendMessage}>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Write a message..."
                rows={4}
                maxLength={5000}
              />

              <button type="submit" disabled={sending || !text.trim()}>
                {sending ? "Sending..." : "Send Message"}
              </button>
            </form>

            {error && <p>{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}
