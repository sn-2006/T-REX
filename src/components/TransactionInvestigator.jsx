import { useState } from "react";
import { investigateTransaction } from "../services/complianceAssistant";

// "Investigate with AI" for a single flagged transaction (an orphaned
// withdrawal or an unmatched deposit). `evidence` is already fully built
// by utils/evidenceBuilder.js — this component just triggers the AI
// explanation and renders it, same audit-trail pattern as DiscrepancyCard.
export default function TransactionInvestigator({ flag, evidence }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleInvestigate() {
    setLoading(true);
    try {
      const r = await investigateTransaction(evidence);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="investigator-row">
      <div className="investigator-message">{flag.message}</div>
      {["VALUATION_UNRESOLVED", "VALUATION_ESTIMATED"].includes(evidence.status) && (
        <div className="muted small">
          Valuation status: {evidence.valuationStatus} · Actual INR received: {evidence.actualInrReceived == null ? "Unavailable" : `₹${evidence.actualInrReceived.toLocaleString("en-IN")}`} · Estimated INR: {evidence.estimatedInrValue == null ? "Unavailable" : `₹${evidence.estimatedInrValue.toLocaleString("en-IN")}`}
        </div>
      )}
      {evidence.status === "PENDING_MANUAL_REVIEW" && (
        <div className="muted small">
          {[
            evidence.asset != null ? `Asset: ${evidence.asset}` : null,
            evidence.quantity != null ? `Amount: ${evidence.quantity}` : null,
            evidence.direction != null ? `Direction: ${evidence.direction}` : null,
            evidence.date != null ? `Date: ${evidence.date}` : null,
            evidence.txHash != null ? `Tx: ${evidence.txHash}` : null,
            evidence.from != null ? `From: ${evidence.from}` : null,
            evidence.to != null ? `To: ${evidence.to}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "On-chain identifiers unavailable for this transfer."}
        </div>
      )}

      {!result && (
        <button className="link-btn" onClick={handleInvestigate} disabled={loading}>
          {loading ? "Investigating..." : "Investigate with AI"}
        </button>
      )}

      {result && (
        <div className="ai-explanation">
          <pre className="ai-investigation-text">{result.investigation}</pre>
          <details className="audit-trail">
            <summary>Evidence used</summary>
            <ul>
              {result.evidenceUsed.map((e, i) => (
                <li key={i}>✓ {e}</li>
              ))}
            </ul>
            <span className="muted small">Source: {result.source === "llm" ? "AI model" : "template (no LLM configured)"}</span>
          </details>
        </div>
      )}
    </li>
  );
}
