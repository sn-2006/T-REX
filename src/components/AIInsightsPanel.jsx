import { useState } from "react";
import { answerReportQuestion } from "../services/complianceAssistant";
import LoadingScreen from "./LoadingTemp";

const SUGGESTED_QUESTIONS = [
  "Show me the largest discrepancies.",
  "Which transactions need manual verification?",
  "Which records are missing?",
];

// The top-of-results "AI Compliance Insights" panel. `insights` is built
// entirely by utils/evidenceBuilder.js from numbers reconcile.js and
// tdsDiscrepancy.js already computed — this component displays them and
// hosts the report Q&A chat, it never computes anything itself.
export default function AIInsightsPanel({ insights, reportContext }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion("");
    setMessages((m) => [...m, { role: "user", text }]);
    setAsking(true);
    try {
      const r = await answerReportQuestion(text, reportContext);
      setMessages((m) => [...m, { role: "assistant", text: r.answer, source: r.source }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="ai-panel">
      <h3>🤖 AI Compliance Insights</h3>

      <div className="ai-stats-grid">
        <div className="ai-stat"><div className="ai-stat-value">{insights.totalTransactions}</div><div className="ai-stat-label">Transactions analyzed</div></div>
        <div className="ai-stat"><div className="ai-stat-value">{insights.matchedTransactions}</div><div className="ai-stat-label">Matched transactions</div></div>
        <div className="ai-stat"><div className="ai-stat-value">{insights.probableTransfers}</div><div className="ai-stat-label">Probable transfers</div></div>
        <div className="ai-stat"><div className="ai-stat-value">{insights.unmatchedTransactions}</div><div className="ai-stat-label">Unmatched transactions</div></div>
        <div className="ai-stat"><div className="ai-stat-value">{insights.tdsDiscrepancyCount}</div><div className="ai-stat-label">TDS discrepancies</div></div>
        <div className="ai-stat"><div className="ai-stat-value">{insights.reviewRequiredCount}</div><div className="ai-stat-label">Pending review</div></div>
        <div className="ai-stat ai-stat-risk"><div className="ai-stat-value">{insights.highRiskCount}</div><div className="ai-stat-label">High-risk transactions</div></div>
      </div>

      <div className="ai-confidence-line">
        {insights.walletOnly ? "On-chain provenance confidence" : "Overall compliance confidence"}
        {" "}(heuristic): <strong>{insights.overallConfidence}%</strong>
        {insights.confidenceLimitations && (
          <div className="muted small">{insights.confidenceLimitations}</div>
        )}
      </div>

      <div className="ai-chat">
        <div className="ai-chat-suggestions">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} className="chip-btn" onClick={() => ask(q)} disabled={asking}>
              {q}
            </button>
          ))}
        </div>

        {messages.length > 0 && (
          <div className="ai-chat-log">
            {messages.map((m, i) => (
              <div key={i} className={`ai-chat-msg ai-chat-${m.role}`}>
                {m.role === "assistant" && (
                  <span className="ai-chat-tag">T-REX AI</span>
                )}
              <div>{m.text}</div>
              </div>
            ))}
          {asking && <LoadingScreen />}
          </div>
        )}

        <form
          className="ai-chat-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <input
            type="text"
            className="name-input"
            placeholder="Ask T-REX about this report..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={asking}
          />
          <button type="submit" className="secondary-btn" disabled={asking || !question.trim()}>
            {asking ? "..." : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}
