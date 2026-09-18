import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { parseExchangeCSV } from "../utils/parseExchange";
import { SUPPORTED_API_EXCHANGES, fetchExchangeTransactions } from "../adapters";
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
import { fetchWalletTransfers, isWalletApiConfigured } from "../adapters/walletAdapter";
import { upsertCase, deriveStatus } from "../data/caseStore";
import { apiFetch } from "../api/client";
import { fetchVerificationStatus } from "../api/verification";
import VerifyAccountPage from "./VerifyAccountPage";
import AIInsightsPanel from "../components/AIInsightsPanel";
import DiscrepancyCard from "../components/DiscrepancyCard";
import TransactionInvestigator from "../components/TransactionInvestigator";
import TransactionFlowGraph from "../components/TransactionFlowGraph";
import LoadingScreen from "../components/LoadingTemp";
import DashboardHeader from "../components/DashboardHeader";
import { getFriendlyBlockchainMessage } from "../utils/friendlyMessage";
import PowerBIAnalytics from "../components/PowerBIAnalytics";

const STEPS = ["upload", "results", "report"];
let nextId = 1;

function newExchange(name = "") {
  return {
    id: nextId++,
    name,
    // "csv" (existing flow) or "api" (new — fetched via an exchange adapter).
    source: "csv",
    file: null,
    // API-mode fields:
    apiExchangeKey: SUPPORTED_API_EXCHANGES[0].key,
    apiKey: "",
    apiSecret: "",
    startDate: "",
    endDate: "",
    rows: null, // normalized rows once a fetch succeeds
    fetching: false,
    fetchError: "",
  };
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

  // Gate: a taxpayer must verify their email and pass KYC before they can
  // reach the upload flow at all — not just before the final "generate
  // report" click. null means "still checking"; the backend enforces this
  // too (see POST /api/cases), this is just so the UI doesn't let someone
  // walk through three steps of work before finding out it'll be rejected.
  const [verifyStatus, setVerifyStatus] = useState(null);
  const [verifyStatusError, setVerifyStatusError] = useState("");

  useEffect(() => {
    refreshVerifyStatus();
  }, []);

  async function refreshVerifyStatus() {
    try {
      setVerifyStatus(await fetchVerificationStatus());
      setVerifyStatusError("");
    } catch (e) {
      setVerifyStatusError(e.message || "Couldn't check your verification status.");
    }
  }

  const isFullyVerified =
    verifyStatus && verifyStatus.emailVerified && verifyStatus.kycStatus === "verified";

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

  // Switches an exchange slot between "Upload CSV" and "Connect via API".
  // Clears whatever the other mode had staged, so stale data can't leak
  // into a reconciliation run through the mode the user isn't using.
  function setExchangeSource(id, source) {
    updateExchange(id, {
      source,
      file: null,
      rows: null,
      fetchError: "",
      name: source === "api" ? SUPPORTED_API_EXCHANGES[0].label : "",
    });
  }

  // Calls the mock adapter for this exchange slot's selected exchange +
  // date range, and stores the normalized rows directly on the slot —
  // same normalized shape parseExchangeCSV produces, so runReconciliation
  // doesn't need to know or care which source it came from.
  async function fetchExchangeApi(id) {
    const ex = exchanges.find((e) => e.id === id);
    if (!ex) return;

    if (!ex.startDate || !ex.endDate) {
      updateExchange(id, { fetchError: "Pick a start and end date first." });
      return;
    }
    if (ex.startDate > ex.endDate) {
      updateExchange(id, { fetchError: "Start date must be before end date." });
      return;
    }

    updateExchange(id, { fetching: true, fetchError: "", rows: null });

    try {
      const rows = await fetchExchangeTransactions(ex.apiExchangeKey, {
        apiKey: ex.apiKey,
        apiSecret: ex.apiSecret,
        startDate: ex.startDate,
        endDate: ex.endDate,
      });
      updateExchange(id, { rows, fetching: false });
    } catch (e) {
      updateExchange(id, { fetching: false, fetchError: e.message || "Fetch failed." });
    }
  }

  async function runReconciliation() {
    setError("");

    const missingName = exchanges.some((ex) => !ex.name.trim());
    const missingCsv = exchanges.some((ex) => ex.source === "csv" && !ex.file);
    const missingApiRows = exchanges.some((ex) => ex.source === "api" && !ex.rows);

    if (missingName || missingCsv || missingApiRows) {
      setError(
        "Give every exchange a name, and either upload its statement file or fetch its transactions via API, to continue."
      );
      return;
    }

    setProcessing(true);

    try {
      const parsedGroups = await Promise.all(
        exchanges.map(async (ex) =>
          ex.source === "api" ? ex.rows : parseExchangeCSV(await ex.file.text(), ex.name.trim())
        )
      );

      const walletAddresses = wallets.map((w) => w.address.trim()).filter(Boolean);

      let walletRows = [];
      if (walletAddresses.length) {
        if (isWalletApiConfigured) {
          try {
            walletRows = (
              await Promise.all(walletAddresses.map((addr) => fetchWalletTransfers(addr)))
            ).flat();
          } catch (walletErr) {
            console.error(walletErr);
            const err = new Error(
              walletErr.message ||
                "Couldn't fetch one of the wallets — check the address and try again."
            );
            err.isWalletFetchError = true;
            throw err;
          }
        } else {
          walletRows = walletAddresses.flatMap((addr) => mockWalletTransfers(addr));
        }
      }

      const rawRows = [...parsedGroups.flat(), ...walletRows];

      // Send the normalized ledger through the backend compliance engine.
      // The server performs VDA-transfer classification, consideration
      // determination and deterministic 194S/TDS gating. The frontend keeps
      // reconciliation/UI rendering unchanged and consumes the authoritative
      // classified rows returned by the backend.
      const complianceResult = await apiFetch("/compliance/analyze", {
        method: "POST",
        body: { rows: rawRows },
      });
      const allRows = complianceResult.rows;

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
      setError(
        e.isWalletFetchError
          ? e.message
          : "Couldn't parse one of the files — check the CSV format and try again."
      );
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
      // The server identifies the owning taxpayer from the auth token, and
      // assigns an auditor round-robin itself — no need to pass either here.
      await upsertCase({
        id: hash,
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
        getFriendlyBlockchainMessage(e)
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
            {isFullyVerified && (
              <nav className="steps">
                {STEPS.map((s, i) => {
                  // A step is reachable if its data already exists — "results"
                  // needs a completed reconciliation, "report" needs a
                  // finalized/anchored report. "upload" is always reachable so
                  // the person can start over. This lets someone freely switch
                  // back and forth between tabs they've already unlocked,
                  // instead of only ever moving forward.
                  const reachable =
                    s === "upload" ||
                    (s === "results" && !!reconciliation) ||
                    (s === "report" && !!anchor);
                  return (
                    <button
                      type="button"
                      key={s}
                      className={`step-pill ${step === s ? "active" : ""} ${
                        STEPS.indexOf(step) > i ? "done" : ""
                      } ${reachable ? "" : "step-pill-disabled"}`}
                      onClick={() => reachable && setStep(s)}
                      disabled={!reachable}
                    >
                      {i + 1}. {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  );
                })}
              </nav>
            )}
          </DashboardHeader>

          <main className="app-main">
            {!verifyStatus ? (
              <section className="card">
                {verifyStatusError ? (
                  <>
                    <div className="error">{verifyStatusError}</div>
                    <button className="secondary-btn" onClick={refreshVerifyStatus}>
                      Try again
                    </button>
                  </>
                ) : (
                  <p className="muted">Checking your account status...</p>
                )}
              </section>
            ) : !isFullyVerified ? (
              <VerifyAccountPage status={verifyStatus} onStatusChange={refreshVerifyStatus} />
            ) : (
              <>
            {step === "upload" && (
              <section className="card">
                <h1>Reconcile TDS across exchanges</h1>
                <p className="muted">
                  Name each exchange and upload its statement. T-REX checks whether TDS is
                  correctly accounted for when assets move between them — the gap no single
                  platform can see on its own.
                </p>

                <div className="exchange-list">
                  {exchanges.map((ex, i) => (
                    <div className="upload-box" key={ex.id}>
                      <div className="upload-box-header">
                        {ex.source === "csv" ? (
                          <input
                            className="name-input"
                            type="text"
                            placeholder={`Exchange ${i + 1} name`}
                            value={ex.name}
                            onChange={(e) => updateExchange(ex.id, { name: e.target.value })}
                          />
                        ) : (
                          <div className="name-input readonly-name">{ex.name}</div>
                        )}
                        {exchanges.length > 2 && (
                          <button className="link-btn danger" onClick={() => removeExchange(ex.id)}>
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="source-toggle" role="tablist">
                        <button
                          type="button"
                          className={`toggle-btn ${ex.source === "csv" ? "active" : ""}`}
                          onClick={() => setExchangeSource(ex.id, "csv")}
                        >
                          Upload CSV
                        </button>
                        <button
                          type="button"
                          className={`toggle-btn ${ex.source === "api" ? "active" : ""}`}
                          onClick={() => setExchangeSource(ex.id, "api")}
                        >
                          Connect via API
                        </button>
                      </div>

                      {ex.source === "csv" ? (
                        <>
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
                        </>
                      ) : (
                        <div className="api-connect-form">
                          <label className="field-label">
                            Exchange
                            <select
                              value={ex.apiExchangeKey}
                              onChange={(e) => {
                                const key = e.target.value;
                                const label = SUPPORTED_API_EXCHANGES.find(
                                  (x) => x.key === key
                                )?.label;
                                updateExchange(ex.id, {
                                  apiExchangeKey: key,
                                  name: label,
                                  rows: null,
                                  fetchError: "",
                                });
                              }}
                            >
                              {SUPPORTED_API_EXCHANGES.map((x) => (
                                <option key={x.key} value={x.key}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field-label">
                            API key
                            <input
                              type="text"
                              placeholder="Read-only API key"
                              value={ex.apiKey}
                              onChange={(e) =>
                                updateExchange(ex.id, { apiKey: e.target.value, rows: null })
                              }
                            />
                          </label>

                          <label className="field-label">
                            API secret
                            <input
                              type="password"
                              placeholder="API secret"
                              value={ex.apiSecret}
                              onChange={(e) =>
                                updateExchange(ex.id, { apiSecret: e.target.value, rows: null })
                              }
                            />
                          </label>

                          <div className="date-range-row">
                            <label className="field-label">
                              From
                              <input
                                type="date"
                                value={ex.startDate}
                                onChange={(e) =>
                                  updateExchange(ex.id, { startDate: e.target.value, rows: null })
                                }
                              />
                            </label>
                            <label className="field-label">
                              To
                              <input
                                type="date"
                                value={ex.endDate}
                                onChange={(e) =>
                                  updateExchange(ex.id, { endDate: e.target.value, rows: null })
                                }
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => fetchExchangeApi(ex.id)}
                            disabled={ex.fetching}
                          >
                            {ex.fetching ? "Fetching..." : "Fetch transactions"}
                          </button>

                          {ex.fetchError && <div className="error small">{ex.fetchError}</div>}

                          {ex.rows && !ex.fetching && (
                            <div className="filename">
                              ✓ Fetched {ex.rows.length} transactions from {ex.name}
                            </div>
                          )}

                          <p className="muted small">
                            Demo mode: this returns realistic sample data shaped like{" "}
                            {ex.name}'s real API response — no live account is contacted.
                          </p>
                        </div>
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
                  {isWalletApiConfigured
                    ? "Wallet transfers are fetched live from the chain via Alchemy when you run reconciliation."
                    : "Wallet transfers are simulated in this prototype — set VITE_WALLET_RPC_URL to fetch real transfers via Alchemy."}
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

                <PowerBIAnalytics
                  allRows={allTransactionRows}
                  discrepancies={discrepancies}
                  reconciliation={reconciliation}
                  role="taxpayer"
                />

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

                {discrepancies.filter((d) => d.hasTdsDiscrepancy === true).length > 0 && (
  <>
    <h3>TDS discrepancies</h3>
    <div className="discrepancy-list">
      {discrepancies
        .filter((d) => d.hasTdsDiscrepancy === true)
        .map((d, i) => (
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
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}
