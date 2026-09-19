import { useState } from "react";
import AIInsightsPanel from "./AIInsightsPanel";
import DiscrepancyCard from "./DiscrepancyCard";
import TransactionInvestigator from "./TransactionInvestigator";
import TransactionFlowGraph from "./TransactionFlowGraph";
import {
  buildDiscrepancyEvidence,
  buildCaseTransactionEvidence,
  resolveCaseWalletAnalyses,
} from "../utils/evidenceBuilder";
import { isChainConfigured, verifyReportOnChain } from "../utils/blockchain";

const STATUS_LABEL = {
  pending: "Pending review",
  "high-risk": "High risk",
  verified: "Verified",
  flagged: "Flagged",
};

// One taxpayer case, fully expanded: everything the taxpayer generated
// (reconciliation, discrepancies, AI insights, flow graph, narrative,
// integrity hash) plus review actions when not read-only. Used by both
// the Auditor dashboard (readOnly=false, sees approve/flag) and the
// Regulator dashboard (readOnly=true, drill-down only).
export default function CaseDetail({ case_, readOnly = false, onApprove, onFlag }) {
  const [verifyState, setVerifyState] = useState(null); // null | "checking" | result
  const [note, setNote] = useState(case_.reviewNote || "");

  const { reconciliation, discrepancies, insights, narrative, allRows } = case_;
  const walletAnalyses = resolveCaseWalletAnalyses(case_);

  async function handleVerify() {
    setVerifyState("checking");
    if (isChainConfigured) {
      try {
        const result = await verifyReportOnChain(case_.reportHash);
        setVerifyState(result.found ? { ok: true, ...result } : { ok: false });
      } catch (e) {
        setVerifyState({ ok: false, error: e.message });
      }
      return;
    }
    // Local fallback — same pattern as VerifyPage.jsx.
    try {
      const raw = localStorage.getItem(`chaintds_report_${case_.reportHash}`);
      setVerifyState(raw ? { ok: true, local: true, ...JSON.parse(raw) } : { ok: false });
    } catch {
      setVerifyState({ ok: false });
    }
  }

  return (
    <div className="case-detail">
      <div className="case-detail-header">
        <div>
          <h2 className="case-detail-title">{case_.taxpayerName}</h2>
          <span className="muted small">
            PAN {case_.panMasked} · {case_.exchanges.join(", ")}
            {case_.wallets?.length > 0 ? ` · ${case_.wallets.length} wallet(s)` : ""}
          </span>
        </div>
        <span className={`case-status-pill case-status-${case_.status}`}>
          {STATUS_LABEL[case_.status] || case_.status}
        </span>
      </div>

      {insights && (
        <AIInsightsPanel
          insights={insights}
          reportContext={{ insights, discrepancies, reconciliation, walletAnalyses }}
        />
      )}

      <h3>Transaction flow graph</h3>
      <TransactionFlowGraph
        allRows={allRows}
        reconciliation={reconciliation}
        discrepancies={discrepancies}
        walletAnalyses={walletAnalyses}
      />

      <h3>Trade summary</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Exchange</th>
            <th>Asset</th>
            <th>Trades</th>
            <th>Amount</th>
            <th>INR value</th>
            <th>TDS deducted</th>
          </tr>
        </thead>
        <tbody>
          {reconciliation.tradeSummary.map((s, i) => (
            <tr key={i}>
              <td>{s.exchange}</td>
              <td>{s.asset}</td>
              <td>{s.tradeCount}</td>
              <td>{s.totalTraded.toFixed(4)}</td>
              <td>{s.totalInr == null ? "Unavailable" : `₹${s.totalInr.toLocaleString("en-IN")}`}</td>
              <td>{s.tdsDeductedCount}/{s.tradeCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Cross-platform transfer check</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Amount</th>
            <th>From</th>
            <th>To</th>
            <th>Status</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {reconciliation.transferChecks.map((t, i) => (
            <tr key={i} className={t.status === "TDS_GAP" ? "row-flag" : ""}>
              <td>{t.asset}</td>
              <td>{t.amount}</td>
              <td>{t.from}</td>
              <td>{t.to}</td>
              <td>{t.status === "TDS_GAP" ? "TDS gap" : "OK"}</td>
              <td>{t.confidence}%</td>
            </tr>
          ))}
          {reconciliation.transferChecks.length === 0 && (
            <tr><td colSpan={6} className="muted">No cross-platform transfers detected.</td></tr>
          )}
        </tbody>
      </table>

      {(reconciliation.warnings.length > 0 || reconciliation.unmatchedDeposits.length > 0) && (
        <>
          <h3>Flagged transactions</h3>
          <ul className="investigator-list">
            {[...reconciliation.warnings, ...reconciliation.unmatchedDeposits].map((flag, i) => (
              <TransactionInvestigator
                key={i}
                flag={flag}
                evidence={buildCaseTransactionEvidence(case_, flag)}
              />
            ))}
          </ul>
        </>
      )}

      {discrepancies.length > 0 && (
        <>
          <h3>TDS discrepancies</h3>
          <div className="discrepancy-list">
            {discrepancies.map((d, i) => (
              <DiscrepancyCard
                key={i}
                discrepancy={d}
                evidence={buildDiscrepancyEvidence(d, { reconciliation, allRows })}
              />
            ))}
          </div>
        </>
      )}

      <h3>AI-generated summary</h3>
      <pre className="narrative">{narrative}</pre>

      <h3>Blockchain verification</h3>
      <div className="kv"><span>SHA-256 report hash</span><code>{case_.reportHash}</code></div>
      {case_.anchor && (
        <>
          <div className="kv"><span>Network</span><code>{case_.anchor.network}</code></div>
          <div className="kv"><span>Tx hash</span><code>{case_.anchor.txHash}</code></div>
        </>
      )}
      <button className="secondary-btn" onClick={handleVerify} disabled={verifyState === "checking"}>
        {verifyState === "checking" ? "Verifying..." : "Verify on-chain"}
      </button>
      {verifyState && verifyState !== "checking" && (
        <p className={`muted small verify-result ${verifyState.ok ? "verify-ok" : "verify-fail"}`}>
          {verifyState.ok
            ? verifyState.local
              ? "✓ Matches the local mock record (no smart contract configured yet)."
              : "✓ Confirmed on-chain."
            : "✗ No matching anchor record found."}
        </p>
      )}

      {!readOnly && (
        <div className="case-review-actions">
          <textarea
            className="name-input review-note"
            placeholder="Add a review note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <div className="case-review-buttons">
            <button className="primary-btn" onClick={() => onApprove?.(note)}>
              Approve / verify
            </button>
            <button className="secondary-btn danger-outline" onClick={() => onFlag?.(note)}>
              Flag for follow-up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
