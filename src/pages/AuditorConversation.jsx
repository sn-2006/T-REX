import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

export default function AuditorConversation({ conversationId }) {
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

      setMessages((current) => [...current, newMessage]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="app-main">
        <section className="card">
          <p>Loading conversation...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-main">
      <section className="card">
        <button
          className="link-btn"
          type="button"
          onClick={() => {
            window.location.hash = "#/auditor";
          }}
        >
          ← Back to Auditor Dashboard
        </button>

        <h1>Private Conversation</h1>

        <p className="muted">
          Confidential conversation with the taxpayer.
        </p>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <div className="conversation-messages">
          {messages.length === 0 ? (
            <p className="muted">
              No messages yet. Start the conversation below.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className="conversation-message"
              >
                <strong>
                  {message.sender_name || "User"}
                </strong>

                <p>{message.message}</p>

                <small className="muted">
                  {new Date(
                    message.created_at
                  ).toLocaleString()}
                </small>
              </div>
            ))
          )}
        </div>

        <form onSubmit={sendMessage}>
          <textarea
            value={text}
            onChange={(event) =>
              setText(event.target.value)
            }
            placeholder="Write a message to the taxpayer..."
            rows={5}
            maxLength={5000}
          />

          <button
            type="submit"
            className="primary-btn"
            disabled={sending || !text.trim()}
          >
            {sending ? "Sending..." : "Send Message"}
          </button>
        </form>
      </section>
    </main>
  );
}