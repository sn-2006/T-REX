import { useState } from "react";
import QRCode from "qrcode";
import { parseExchangeCSV } from "../utils/parseExchange";
import { reconcile } from "../utils/reconcile";
import { computeTdsDiscrepancies } from "../utils/tdsDiscrepancy";
import {
  buildComplianceInsights,
  buildDiscrepancyEvidence,
  buildTransactionEvidence,
} from "../utils/evidenceBuilder";
import { generateNarrativeReport } from "../utils/aiReport";
import { sha256Hex, mockAnchorOnChain } from "../utils/hash";
import { anchorReportOnChain, isChainConfigured, verifyReportOnChain } from "../utils/blockchain";
import { buildReportPdf } from "../utils/exportPdf";
import { mockWalletTransfers } from "../utils/walletMock";
import { upsertCase, nextAuditorAssignment, deriveStatus } from "../data/caseStore";
import AIInsightsPanel from "../components/AIInsightsPanel";
import DiscrepancyCard from "../components/DiscrepancyCard";
import TransactionInvestigator from "../components/TransactionInvestigator";
import TransactionFlowGraph from "../components/TransactionFlowGraph";
import LoadingScreen from "../components/LoadingTemp";
import DashboardHeader from "../components/DashboardHeader";

const STEPS = ["upload", "results", "report"];
let nextId = 1;

function newExchange(name = "") {
  return { id: nextId++, name, file: null };
}
function newWallet() {
  return { id: nextId++, address: "" };
}

export default function TaxpayerDashboard({ session, onLogout }) {
  const [step, setStep] = useState("upload");
  const [exchanges, setExchanges] = useState([
    newExchange("Exchange A"),
    newExchange("Exchange B"),
  ]);
  const [wallets, setWallets] = useState([newWallet()]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [reconciliation, setReconciliation] = useState(null);
  const [narrative, setNarrative] = useState("");
  const [reportHash, setReportHash] = useState("");
  const [anchor, setAnchor] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verifyState, setVerifyState] = useState(null);

  const [allTransactionRows, setAllTransactionRows] = useState([]);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [insights, setInsights] = useState(null);

  function updateExchange(id, patch) {
    setExchanges((list) => list.map((ex) => (ex.id === id ? { ...ex, ...patch } : ex)));
  }
  function addExchange() {
    setExchanges((list) => [...list, newExchange("")]);
  }
  function removeExchange(id) {
    setExchanges((list) => (list.length > 2 ? list.filter((ex) => ex.id !== id) : list));
  }

  function updateWallet(id, patch) {
    setWallets((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }
  function addWallet() {
    setWallets((list) => [...list, newWallet()]);
  }
  function removeWallet(id) {
    setWallets((list) => (list.length > 1 ? list.filter((w) => w.id !== id) : list));
  }

  async function loadSample(id, path) {
    const res = await fetch(path);
    const text = await res.text();
    updateExchange(id, {
      file: new File([text], path.split("/").pop(), { type: "text/csv" }),
    });
  }

  async function runReconciliation() {
    setError("");

    const missingName = exchanges.some((ex) => !ex.name.trim());
    const missingFile = exchanges.some((ex) => !ex.file);

    if (missingName || missingFile) {
      setError(
        "Give every exchange a name and upload its statement file (or load sample data) to continue."
      );
      return;
    }

    setProcessing(true);

    try {
      const parsedGroups = await Promise.all(
        exchanges.map(async (ex) => parseExchangeCSV(await ex.file.text(), ex.name.trim()))
      );

      const walletRows = wallets
        .filter((w) => w.address.trim())
        .flatMap((w) => mockWalletTransfers(w.address.trim()));

      const allRows = [...parsedGroups.flat(), ...walletRows];

      const result = reconcile(allRows);

      setReconciliation(result);
      setNarrative(generateNarrativeReport(result));

      const discrepancyList = computeTdsDiscrepancies(allRows);

      setDiscrepancies(discrepancyList);
      setAllTransactionRows(allRows);

      setInsights(
        buildComplianceInsights({
          allRows,
          reconciliation: result,
          discrepancies: discrepancyList,
        })
      );

      setStep("results");
    } catch (e) {
      console.error(e);
      setError("Couldn't parse one of the files — check the CSV format and try again.");
    } finally {
      setProcessing(false);
    }
  }

  async function finalizeReport() {
    setProcessing(true);
    setError("");

    try {
      const hash = await sha256Hex({
        reconciliation,
        narrative,
        generatedAt: Date.now(),
      });

      setReportHash(hash);

      const anchorResult = isChainConfigured
        ? await anchorReportOnChain(hash)
        : mockAnchorOnChain(hash);

      setAnchor(anchorResult);

      localStorage.setItem(
        `chaintds_report_${hash}`,
        JSON.stringify({ ...anchorResult, reportHash: hash })
      );

      // Register this report as a case for the Auditor / Regulator dashboards.
      upsertCase({
        id: hash,
        taxpayerId: session.id,
        taxpayerName: session.name,
        panMasked: session.panMasked || session.id,
        auditorId: nextAuditorAssignment(),
        exchanges: exchanges.map((ex) => ex.name.trim()),
        wallets: wallets.filter((w) => w.address.trim()).map((w) => w.address.trim()),
        allRows: allTransactionRows,
        reconciliation,
        discrepancies,
        insights,
        narrative,
        reportHash: hash,
        anchor: anchorResult,
        status: deriveStatus(insights),
        reviewNote: "",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        demo: false,
      });

      const verifyUrl = `${window.location.origin}${window.location.pathname}#/verify/${hash}`;
      const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });
      setQrDataUrl(qr);
      setStep("report");
    } catch (e) {
      console.error(e);
      setError(
        e.message || "Couldn't anchor the report — check your wallet/network and try again."
      );
    } finally {
      setProcessing(false);
    }
  }

  async function handleVerifyOnChain() {
    setVerifyState("checking");
    try {
      if (isChainConfigured) {
        const result = await verifyReportOnChain(reportHash);
        setVerifyState(result.found ? { ok: true, ...result } : { ok: false });
      } else {
        const raw = localStorage.getItem(`chaintds_report_${reportHash}`);
        setVerifyState(raw ? { ok: true, local: true, ...JSON.parse(raw) } : { ok: false });
      }
    } catch (e) {
      setVerifyState({ ok: false, error: e.message });
    }
  }

  function downloadPdf() {
    const doc = buildReportPdf({ ...reconciliation, narrative, reportHash, anchor });
    doc.save("chaintds-report.pdf");
  }

  function startNew() {
    setStep("upload");
    setReconciliation(null);
    setDiscrepancies([]);
    setInsights(null);
    setAllTransactionRows([]);
    setAnchor(null);
    setReportHash("");
    setQrDataUrl("");
    setVerifyState(null);
  }

  return (
    <div className="app">
      {processing ? (
        <LoadingScreen />
      ) : (
        <>
          <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout}>
            <nav className="steps">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`step-pill ${step === s ? "active" : ""} ${
                    STEPS.indexOf(step) > i ? "done" : ""
                  }`}
                >
                  {i + 1}. {s[0].toUpperCase() + s.slice(1)}
                </div>
              ))}
            </nav>
          </DashboardHeader>

          <main className="app-main">
            {step === "upload" && (
              <section className="card">
                <h1>Reconcile TDS across exchanges</h1>
                <p className="muted">
                  Name each exchange and upload its statement. ChainTDS checks whether TDS is
                  correctly accounted for when assets move between them — the gap no single
                  platform can see on its own.
                </p>

                <div className="exchange-list">
                  {exchanges.map((ex, i) => (
                    <div className="upload-box" key={ex.id}>
                      <div className="upload-box-header">
                        <input
                          className="name-input"
                          type="text"
                          placeholder={`Exchange ${i + 1} name`}
                          value={ex.name}
                          onChange={(e) => updateExchange(ex.id, { name: e.target.value })}
                        />
                        {exchanges.length > 2 && (
                          <button className="link-btn danger" onClick={() => removeExchange(ex.id)}>
                            Remove
                          </button>
                        )}
                      </div>

                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) =>
                          updateExchange(ex.id, { file: e.target.files?.[0] || ex.file })
                        }
                      />

                      {ex.file && <div className="filename">{ex.file.name}</div>}

                      {i < 2 && (
                        <button
                          className="link-btn"
                          onClick={() =>
                            loadSample(
                              ex.id,
                              i === 0 ? "/sample-exchange-a.csv" : "/sample-exchange-b.csv"
                            )
                          }
                        >
                          Use sample data
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button className="secondary-btn" onClick={addExchange}>
                  + Add another exchange
                </button>

                <h3>Wallets</h3>
                <p className="muted small">
                  Add every wallet a transfer between exchanges may have passed{" "}
                  <em>through</em> — not needed for direct exchange-to-exchange transfers.
                </p>

                <div className="wallet-list">
                  {wallets.map((w, i) => (
                    <div className="wallet-row" key={w.id}>
                      <label className="wallet-label">
                        Wallet {i + 1} address
                        <input
                          className="name-input"
                          type="text"
                          placeholder="0x..."
                          value={w.address}
                          onChange={(e) => updateWallet(w.id, { address: e.target.value })}
                        />
                      </label>
                      {wallets.length > 1 && (
                        <button className="link-btn danger" onClick={() => removeWallet(w.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button className="secondary-btn" onClick={addWallet}>
                  + Add another wallet
                </button>

                <p className="muted small" style={{ marginTop: 16 }}>
                  Wallet transfers are simulated in this prototype; real reads come from
                  Alchemy in the full build.
                </p>

                {error && <div className="error">{error}</div>}

                <button className="primary-btn" onClick={runReconciliation} disabled={processing}>
                  {processing ? "Reconciling..." : "Run reconciliation"}
                </button>
              </section>
            )}

            {step === "results" && reconciliation && (
              <section className="card">
                <h1>Reconciliation results</h1>

                {insights && (
                  <AIInsightsPanel
                    insights={insights}
                    reportContext={{ insights, discrepancies, reconciliation }}
                  />
                )}

                <h3>Transaction flow graph</h3>
                <TransactionFlowGraph
                  allRows={allTransactionRows}
                  reconciliation={reconciliation}
                  discrepancies={discrepancies}
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
                        <td>₹{s.totalInr.toLocaleString("en-IN")}</td>
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
                      <tr>
                        <td colSpan={6} className="muted">
                          No cross-platform transfers detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <h3>Warnings</h3>
                {reconciliation.warnings.length === 0 &&
                reconciliation.unmatchedDeposits.length === 0 ? (
                  <p className="muted">No warnings — everything reconciled cleanly.</p>
                ) : (
                  <ul className="warning-list">
                    {reconciliation.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                    {reconciliation.unmatchedDeposits.map((w, i) => (
                      <li key={`ud-${i}`}>{w.message}</li>
                    ))}
                  </ul>
                )}

                {(reconciliation.warnings.length > 0 ||
                  reconciliation.unmatchedDeposits.length > 0) && (
                  <>
                    <h3>Investigate flagged transactions</h3>
                    <ul className="investigator-list">
                      {[...reconciliation.warnings, ...reconciliation.unmatchedDeposits].map(
                        (flag, i) => (
                          <TransactionInvestigator
                            key={i}
                            flag={flag}
                            evidence={buildTransactionEvidence(flag, {
                              reconciliation,
                              allRows: allTransactionRows,
                            })}
                          />
                        )
                      )}
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
                          evidence={buildDiscrepancyEvidence(d, {
                            reconciliation,
                            allRows: allTransactionRows,
                          })}
                        />
                      ))}
                    </div>
                  </>
                )}

                <h3>AI-generated summary</h3>
                <pre className="narrative">{narrative}</pre>

                {error && <div className="error">{error}</div>}

                <button className="primary-btn" onClick={finalizeReport} disabled={processing}>
                  {processing ? "Generating..." : "Generate report + hash"}
                </button>
              </section>
            )}

            {step === "report" && anchor && (
              <section className="card">
                <h1>Report finalized</h1>
                <p className="muted">
                  This report's fingerprint has been anchored{" "}
                  {isChainConfigured ? "via MetaMask" : "(simulated)"} on{" "}
                  {anchor.network}. Scan the QR — it opens a real verification page in this
                  app rather than a placeholder link.
                </p>

                <div className="report-grid">
                  <div>
                    <h3>Integrity</h3>
                    <div className="kv"><span>SHA-256</span><code>{reportHash}</code></div>
                    <div className="kv"><span>Network</span><code>{anchor.network}</code></div>
                    <div className="kv"><span>Tx hash</span><code>{anchor.txHash}</code></div>
                    <div className="kv"><span>Block</span><code>{anchor.blockNumber}</code></div>

                    <button className="secondary-btn" onClick={handleVerifyOnChain}>
                      {verifyState === "checking" ? "Verifying..." : "Verify on-chain"}
                    </button>

                    {verifyState && verifyState !== "checking" && (
                      <p className={`muted small verify-result ${verifyState.ok ? "verify-ok" : "verify-fail"}`}>
                        {verifyState.ok
                          ? verifyState.local
                            ? "✓ Matches the local mock record."
                            : "✓ Confirmed on-chain."
                          : "✗ No matching anchor record found."}
                      </p>
                    )}

                    <button className="primary-btn" onClick={downloadPdf}>
                      Download PDF report
                    </button>
                  </div>

                  <div className="qr-box">
                    {qrDataUrl && <img src={qrDataUrl} alt="Verification QR code" />}
                    <span className="muted small">Scan to verify</span>
                  </div>
                </div>

                <button className="link-btn" onClick={startNew}>
                  Start a new reconciliation
                </button>
              </section>
            )}
          </main>
        </>
      )}
    </div>
  );
}
