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
import { isChainConfigured, verifyReportOnChain, verifyCertificateOnChain } from "../utils/blockchain";

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
  const [isIssuingCert, setIsIssuingCert] = useState(false);
  const [certFeedback, setCertFeedback] = useState("");

  const { reconciliation, discrepancies, insights, narrative, allRows } = case_;
  const walletAnalyses = resolveCaseWalletAnalyses(case_);

  async function handleVerify() {
    setVerifyState("checking");
    if (isChainConfigured) {
      try {
        const anchorResult = await verifyReportOnChain(case_.reportHash);
        let certResult = null;
        try {
          certResult = await verifyCertificateOnChain(case_.reportHash);
        } catch {}
        setVerifyState(
          anchorResult.found
            ? { ok: true, ...anchorResult, cert: certResult }
            : { ok: false }
        );
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

  async function handleApproveClick() {
    if (!onApprove) return;
    setIsIssuingCert(true);
    setCertFeedback("Connecting wallet & issuing MST Compliance Certificate on-chain...");
    try {
      await onApprove(note);
      setCertFeedback("");
    } catch (err) {
      setCertFeedback(`❌ Certificate issuance failed: ${err.message || "Wallet transaction rejected."}`);
    } finally {
      setIsIssuingCert(false);
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Transaction history (All rows)</h3>
        <button 
          className="secondary-btn small" 
          onClick={() => {
            const headers = "Date,Exchange,Type,Asset,Amount,INR Value,TDS,Ref ID\n";
            const csv = allRows.map(r => `${r.date},${r.exchange},${r.type},${r.asset},${r.amount},${r.inrValue},${r.tdsAmount !== null ? r.tdsAmount : ""},${r.refId}`).join("\n");
            const blob = new Blob([headers + csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transactions_${case_.reportHash.slice(0,8)}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </button>
      </div>
      <div style={{ maxHeight: "400px", overflowY: "auto", marginBottom: "24px" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Exchange</th>
              <th>Type</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>INR value</th>
              <th>TDS</th>
              <th>Ref ID</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((r, i) => (
              <tr key={i}>
                <td>{r.date}</td>
                <td>{r.exchange}</td>
                <td>{r.type}</td>
                <td>{r.asset}</td>
                <td>{r.amount}</td>
                <td>{r.inrValue}</td>
                <td>{r.tdsAmount !== null ? r.tdsAmount : "-"}</td>
                <td style={{ fontSize: "10px", wordBreak: "break-all" }}>{r.refId}</td>
              </tr>
            ))}
            {allRows.length === 0 && (
              <tr><td colSpan={8} className="muted">No transactions found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

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
          <div className="kv"><span>Anchor Tx hash</span><code>{case_.anchor.txHash}</code></div>
        </>
      )}
      {case_.complianceCertificate && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 6, background: "rgba(255, 255, 255, 0.02)" }}>
          <strong style={{ fontSize: "13px" }}>MST Compliance Certificate Metadata</strong>
          <div className="kv" style={{ marginTop: 6 }}><span>Cert ID</span><code>{case_.complianceCertificate.certId}</code></div>
          <div className="kv"><span>Cert Tx hash</span><code>{case_.complianceCertificate.txHash}</code></div>
          <div className="kv"><span>Auditor</span><code>{case_.complianceCertificate.auditorAddress}</code></div>
          <div className="kv"><span>Issued at</span><code>{case_.complianceCertificate.issuedAt}</code></div>
          <div className="kv"><span>Status</span><code>{case_.complianceCertificate.status === "1" ? "1 (Verified)" : case_.complianceCertificate.status}</code></div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="secondary-btn" onClick={handleVerify} disabled={verifyState === "checking"}>
          {verifyState === "checking" ? "Verifying..." : "Verify on-chain"}
        </button>
      </div>
      {verifyState && verifyState !== "checking" && (
        <div style={{ marginTop: 10 }}>
          {verifyState.ok ? (
            verifyState.local ? (
              <p className="muted small verify-result verify-ok">✓ Matches the local mock record (no smart contract configured yet).</p>
            ) : verifyState.certError ? (
              <p className="muted small verify-result verify-fail">⚠️ Report hash anchored on-chain, but certificate lookup failed ({verifyState.certError}).</p>
            ) : verifyState.cert?.valid ? (
              <p className="muted small verify-result verify-ok">✓ Live MST Contract: Compliance Certificate is ACTIVE & VERIFIED by Auditor ({verifyState.cert.auditor.slice(0, 10)}...).</p>
            ) : verifyState.cert?.revoked ? (
              <p className="muted small verify-result verify-fail">❌ Live MST Contract: Compliance Certificate was REVOKED ({verifyState.cert.details?.revocationReason || "Revoked"}).</p>
            ) : (
              <p className="muted small verify-result verify-ok">✓ Report hash anchored on-chain. (No on-chain auditor compliance certificate issued yet).</p>
            )
          ) : (
            <p className="muted small verify-result verify-fail">✗ No matching anchor record found on MST smart contract.</p>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="case-review-actions">
          <textarea
            className="name-input review-note"
            placeholder="Add a review note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={isIssuingCert}
          />
          <div className="case-review-buttons">
            <button className="primary-btn" onClick={handleApproveClick} disabled={isIssuingCert}>
              {isIssuingCert ? "Issuing Certificate..." : "Approve / verify"}
            </button>
            <button className="secondary-btn danger-outline" onClick={() => onFlag?.(note)} disabled={isIssuingCert}>
              Flag for follow-up
            </button>
          </div>
          {certFeedback && (
            <p className="muted small" style={{ marginTop: 8, color: certFeedback.startsWith("❌") ? "#ff9b9b" : "var(--green)" }}>
              {certFeedback}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

