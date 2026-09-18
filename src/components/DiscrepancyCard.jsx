import { useState } from "react";
import { explainDiscrepancy } from "../services/complianceAssistant";
import ConfidenceBadge from "./ConfidenceBadge";

// One TDS discrepancy, with an on-demand AI explanation. The discrepancy
// numbers themselves (expected/reported/difference/risk) all come straight
// from utils/tdsDiscrepancy.js — this component never recalculates them,
// it only asks the AI to explain them in plain language on request.
export default function DiscrepancyCard({ discrepancy, evidence }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleExplain() {
    setLoading(true);
    try {
      const r = await explainDiscrepancy(evidence);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`discrepancy-card risk-${discrepancy.riskTier}`}>
      <div className="discrepancy-header">
        <div>
          <strong>{discrepancy.transactionId}</strong>
          <span className="muted small">
            {" "}
            · {discrepancy.type} {discrepancy.quantity} {discrepancy.asset} on {discrepancy.exchange} · {discrepancy.date}
          </span>
        </div>
        <span className={`risk-pill risk-pill-${discrepancy.riskTier}`}>{discrepancy.riskTier} risk</span>
      </div>

      <div className="discrepancy-figures">
        <span>Expected: ₹{discrepancy.expectedTds.toLocaleString("en-IN")}</span>
        <span>Reported: ₹{discrepancy.reportedTds.toLocaleString("en-IN")}</span>
        <span className={discrepancy.difference > 0 ? "figure-negative" : "figure-positive"}>
          Difference: ₹{Math.abs(discrepancy.difference).toLocaleString("en-IN")}
        </span>
      </div>

      {evidence.transferConfidence !== null && <ConfidenceBadge score={evidence.transferConfidence} />}

      {!result && (
        <button className="link-btn" onClick={handleExplain} disabled={loading}>
          {loading ? "Thinking..." : "Why is this a discrepancy?"}
        </button>
      )}

      {result && (
        <div className="ai-explanation">
          <div className="ai-explanation-text">{result.explanation}</div>
          <details className="audit-trail">
            <summary>Audit trail — evidence used</summary>
            <ul>
              {result.evidenceUsed.map((e, i) => (
                <li key={i}>✓ {e}</li>
              ))}
            </ul>
            <span className="muted small">Source: {result.source === "llm" ? "AI model" : "template (no LLM configured)"}</span>
          </details>
        </div>
      )}
    </div>
  );
}
