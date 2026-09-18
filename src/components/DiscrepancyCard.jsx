import { useState } from "react";
import { explainDiscrepancy } from "../services/complianceAssistant";
import ConfidenceBadge from "./ConfidenceBadge";

// One TDS/valuation discrepancy, with on-demand AI explanation. The
// deterministic rule-engine values are displayed as-is; this component does
// not recalculate tax or consideration.
export default function DiscrepancyCard({ discrepancy, evidence }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleExplain() {
    setLoading(true);
    try {
      const r = await explainDiscrepancy(evidence);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  const considerationValue =
    discrepancy.inrValue == null ? "Unresolved" : `₹${discrepancy.inrValue.toLocaleString("en-IN")}`;
  const expectedValue =
    discrepancy.expectedTds == null ? "Unresolved" : `₹${discrepancy.expectedTds.toLocaleString("en-IN")}`;
  const reportedValue = `₹${discrepancy.reportedTds.toLocaleString("en-IN")}`;
  const valuationDifference = discrepancy.consideration?.valuationDifference;

  return (
    <div id={`trex-discrepancy-${discrepancy.transactionId}`} className={`discrepancy-card risk-${discrepancy.riskTier}`}>
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
        <span>Consideration: {considerationValue}</span>
        <span>Expected TDS: {expectedValue}</span>
        <span>Reported TDS: {reportedValue}</span>
        {discrepancy.hasValuationDiscrepancy && (
          <span className="figure-negative">
            Valuation difference: ₹{Math.abs(valuationDifference).toLocaleString("en-IN")}
          </span>
        )}
        {discrepancy.difference != null && (
          <span className={discrepancy.difference > 0 ? "figure-negative" : "figure-positive"}>
            TDS difference: ₹{Math.abs(discrepancy.difference).toLocaleString("en-IN")}
          </span>
        )}
      </div>

      {evidence.transferConfidence !== null && <ConfidenceBadge score={evidence.transferConfidence} />}

      <div className="discrepancy-actions">
        <button className="secondary-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide details" : "Investigate"}
        </button>
        {!result && (
          <button className="primary-btn discrepancy-ai-btn" onClick={handleExplain} disabled={loading}>
            {loading ? "Thinking..." : "Explain with AI"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="discrepancy-detail-panel">
          <div><span>Transaction</span><strong>{discrepancy.transactionId}</strong></div>
          <div><span>VDA transfer</span><strong>{discrepancy.vdaTransferStatus === "CONFIRMED" ? "Confirmed" : "Undetermined"}</strong></div>
          <div><span>Transfer type</span><strong>{discrepancy.transferType || "—"}</strong></div>
          <div><span>Transfer confidence</span><strong>{discrepancy.transferConfidence ?? 0}%</strong></div>
          <div><span>Consideration method</span><strong>{discrepancy.consideration?.method || "—"}</strong></div>
          <div><span>Consideration source</span><strong>{discrepancy.consideration?.source || "—"}</strong></div>
          <div><span>Consideration status</span><strong>{discrepancy.consideration?.valuationStatus || "—"}</strong></div>
          <div><span>Reported consideration</span><strong>
            {discrepancy.consideration?.reportedInrValue == null
              ? "Missing"
              : `₹${discrepancy.consideration.reportedInrValue.toLocaleString("en-IN")}`}
          </strong></div>
          <div><span>Determined consideration</span><strong>
            {discrepancy.inrValue == null ? "Unresolved" : `₹${discrepancy.inrValue.toLocaleString("en-IN")}`}
          </strong></div>
          {valuationDifference != null && (
            <div><span>Valuation difference</span><strong>₹{Math.abs(valuationDifference).toLocaleString("en-IN")}</strong></div>
          )}
          <div><span>Expected TDS</span><strong>{expectedValue}</strong></div>
          <div><span>Reported TDS</span><strong>{reportedValue}</strong></div>
          {discrepancy.difference != null && (
            <div><span>TDS gap</span><strong>₹{Math.abs(discrepancy.difference).toLocaleString("en-IN")}</strong></div>
          )}
          <div><span>Reported source</span><strong>{discrepancy.reportedSource || "—"}</strong></div>
        </div>
      )}

      {result && (
        <div className="ai-explanation">
          <div className="ai-explanation-text">{result.explanation}</div>
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
    </div>
  );
}
