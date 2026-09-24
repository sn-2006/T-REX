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
          <button className="primary-btn discrepancy-ai-btn" onClick={handleExplain} disabled={loading} style={{ minWidth: '160px' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <style>{`
                  @keyframes pbi-run {
                    0% { transform: translateX(-10px) scaleX(1); }
                    49% { transform: translateX(10px) scaleX(1); }
                    50% { transform: translateX(10px) scaleX(-1); }
                    99% { transform: translateX(-10px) scaleX(-1); }
                    100% { transform: translateX(-10px) scaleX(1); }
                  }
                `}</style>
                <div style={{ width: '30px', display: 'flex', justifyContent: 'center' }}>
                  <span style={{ fontSize: '18px', animation: 'pbi-run 1.5s linear infinite', display: 'inline-block' }}>🦖</span>
                </div>
                <span>ANALYZING...</span>
              </div>
            ) : (
              "Explain with AI"
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="discrepancy-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px', padding: '16px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Transaction</span><strong>{discrepancy.transactionId}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>VDA transfer</span><strong>{discrepancy.vdaTransferStatus === "CONFIRMED" ? "Confirmed" : "Undetermined"}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Transfer type</span><strong>{discrepancy.transferType || "—"}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Transfer confidence</span><strong>{discrepancy.transferConfidence ?? 0}%</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Consideration method</span><strong>{discrepancy.consideration?.method || "—"}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Consideration source</span><strong>{discrepancy.consideration?.source || "—"}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Consideration status</span><strong>{discrepancy.consideration?.valuationStatus || "—"}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Reported consideration</span><strong>
            {discrepancy.consideration?.reportedInrValue == null
              ? "Missing"
              : `₹${discrepancy.consideration.reportedInrValue.toLocaleString("en-IN")}`}
          </strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Determined consideration</span><strong>
            {discrepancy.inrValue == null ? "Unresolved" : `₹${discrepancy.inrValue.toLocaleString("en-IN")}`}
          </strong></div>
          {valuationDifference != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Valuation difference</span><strong>₹{Math.abs(valuationDifference).toLocaleString("en-IN")}</strong></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Expected TDS</span><strong>{expectedValue}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Reported TDS</span><strong>{reportedValue}</strong></div>
          {discrepancy.difference != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>TDS gap</span><strong>₹{Math.abs(discrepancy.difference).toLocaleString("en-IN")}</strong></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#888' }}>Reported source</span><strong>{discrepancy.reportedSource || "—"}</strong></div>
        </div>
      )}

      {result && (
        <div className="ai-explanation" style={{ marginTop: '16px', padding: '16px', backgroundColor: 'rgba(124, 151, 116, 0.15)', borderRadius: '8px', border: '1px solid rgba(124, 151, 116, 0.4)', color: '#eaeaea' }}>
          <div className="ai-explanation-text" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '14px' }}>{result.explanation}</div>
          <details className="audit-trail" style={{ marginTop: '12px', fontSize: '13px' }}>
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
