import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { parseExchangeCSV } from "../utils/parseExchange";
import { SUPPORTED_API_EXCHANGES, fetchExchangeTransactions } from "../adapters";
import { reconcile, withWalletReconciliationFlags } from "../utils/reconcile";
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
import { fetchWalletAnalysis, SUPPORTED_WALLET_CHAINS } from "../adapters/walletAdapter";
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
  const [walletAnalyses, setWalletAnalyses] = useState({});
  const [walletAnalyzing, setWalletAnalyzing] = useState({});
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

  async function analyzeWallet(id) {
    const wallet = wallets.find((w) => w.id === id);
    if (!wallet?.address.trim()) return;

    setWalletAnalyzing((state) => ({ ...state, [id]: true }));
    setError("");
    try {
      const analysis = await fetchWalletAnalysis(wallet.address.trim());
      setWalletAnalyses((state) => ({ ...state, [id]: analysis }));
    } catch (e) {
      setError(e.message || "Couldn't analyze the wallet on-chain.");
    } finally {
      setWalletAnalyzing((state) => ({ ...state, [id]: false }));
    }
  }

 async function runReconciliation() {
  setError("");

  const walletAddresses = wallets
    .map((w) => w.address.trim())
    .filter(Boolean);

  // An exchange is required only when the user has not supplied a wallet.
  // This allows:
  //   1. CSV/API only
  //   2. Wallet only
  //   3. CSV/API + wallet
  const missingName = exchanges.some((ex) => !ex.name.trim());
  const missingCsv = exchanges.some(
    (ex) => ex.source === "csv" && !ex.file
  );
  const missingApiRows = exchanges.some(
    (ex) => ex.source === "api" && !ex.rows
  );

  if (
    walletAddresses.length === 0 &&
    (missingName || missingCsv || missingApiRows)
  ) {
    setError(
      "Add a wallet address or give every exchange a name and either upload its statement file or fetch its transactions via API."
    );
    return;
  }

  setProcessing(true);

  try {
    // ---------------------------------------------------------------
    // 1. LOAD CENTRALIZED EXCHANGE DATA
    // ---------------------------------------------------------------

    const parsedGroups = await Promise.all(
      exchanges
        .filter(
          (ex) =>
            ex.name.trim() &&
            (ex.source === "api" ? ex.rows : ex.file)
        )
        .map(async (ex) =>
          ex.source === "api"
            ? ex.rows
            : parseExchangeCSV(await ex.file.text(), ex.name.trim())
        )
    );

    // ---------------------------------------------------------------
    // 2. LOAD DECENTRALIZED WALLET DATA
    // ---------------------------------------------------------------

    let walletResults = [];

    if (walletAddresses.length > 0) {
      try {
        walletResults = await Promise.all(
          wallets
            .filter((w) => w.address.trim())
            .map(async (w) => {
              const existing = walletAnalyses[w.id];

              if (
                existing &&
                existing.wallet.toLowerCase() ===
                  w.address.trim().toLowerCase()
              ) {
                return {
                  id: w.id,
                  analysis: existing,
                };
              }

              const analysis = await fetchWalletAnalysis(
                w.address.trim()
              );

              return {
                id: w.id,
                analysis,
              };
            })
        );

        // Keep wallet analyses in React state for the wallet UI.
        setWalletAnalyses((state) => {
          const updated = { ...state };

          for (const { id, analysis } of walletResults) {
            updated[id] = analysis;
          }

          return updated;
        });
      } catch (walletErr) {
        console.error(walletErr);

        const err = new Error(
          walletErr.message ||
            "Couldn't fetch one of the wallets — check the address and server configuration."
        );

        err.isWalletFetchError = true;
        throw err;
      }
    }

    // ---------------------------------------------------------------
    // 3. CENTRALIZED RECONCILIATION
    // ---------------------------------------------------------------

    const rawRows = parsedGroups.flat();

    // Wallet analysis can now produce reconstructed DEX events in the same
    // normalized row shape consumed by the existing compliance engine. Raw
    // wallet movements remain provenance-only and are never added here.
    const walletDerivedRows = walletResults.flatMap(
      ({ analysis }) => analysis?.derivedTransactions || []
    );
    const complianceInputRows = [...rawRows, ...walletDerivedRows];

    let allRows = [];
    let result;

    if (complianceInputRows.length > 0) {
      // Both centralized CSV/API rows and reconstructed decentralized DEX
      // events use the same authoritative compliance + TDS pipeline.
      const complianceResult = await apiFetch("/compliance/analyze", {
        method: "POST",
        body: { rows: complianceInputRows },
      });

      allRows = complianceResult.rows;

      // Existing reconciliation remains unchanged for centralized rows;
      // reconstructed DEX events are simply normalized trade rows here.
      result = reconcile(allRows);
    } else {
      // -------------------------------------------------------------
      // WALLET-ONLY MODE
      // -------------------------------------------------------------

      result = {
        tradeSummary: [],
        transferChecks: [],
        warnings: [],
        unmatchedDeposits: [],

        mode: "DECENTRALIZED_WALLET",

        walletReconciliation: walletResults
          .map(({ analysis }) => analysis?.reconciliation)
          .filter(Boolean),
      };
    }

    // ---------------------------------------------------------------
    // 4. COMBINE WALLET RECONCILIATION WITH CENTRALIZED RESULT
    // ---------------------------------------------------------------

    const walletReconciliation = walletResults
      .map(({ analysis }) => analysis?.reconciliation)
      .filter(Boolean);

    // Use the wallet results from THIS run rather than relying on
    // React state, which updates asynchronously.
    const walletList = walletResults
      .map(({ analysis }) => analysis)
      .filter(Boolean);

    // Fold wallet pending-review inventory into the same warnings channel
    // used by the dashboard, investigation list, and AI narrative.
    result = {
      ...withWalletReconciliationFlags(result, walletList),
      walletReconciliation,
    };

    setReconciliation(result);

    const walletTransferCount = walletList.reduce(
      (sum, analysis) =>
        sum + (Number(analysis.transferCount) || 0),
      0
    );

    // ---------------------------------------------------------------
    // 5. NARRATIVE — same reconciliation reporting for wallet-only and
    // exchange/DEX paths (pending review, warnings, recommended actions).
    // ---------------------------------------------------------------

    const reportNarrative = generateNarrativeReport({
      ...result,
      mode: allRows.length === 0 && walletTransferCount > 0 ? "DECENTRALIZED_WALLET" : result.mode,
      walletAnalyses: walletList,
      walletTransferCount,
      walletReconciliation,
    });

    setNarrative(reportNarrative);

    // ---------------------------------------------------------------
    // 6. TDS DISCREPANCIES
    // ---------------------------------------------------------------

    const discrepancyList = computeTdsDiscrepancies(allRows);

    setDiscrepancies(discrepancyList);
    setAllTransactionRows(allRows);

    // ---------------------------------------------------------------
    // 7. AI INSIGHTS
    // ---------------------------------------------------------------

    const walletAnalysesForRun = walletList;

    setInsights(
      buildComplianceInsights({
        allRows,
        reconciliation: result,
        discrepancies: discrepancyList,
        walletAnalyses: walletAnalysesForRun,
      })
    );

    // ---------------------------------------------------------------
    // 8. MOVE TO RESULTS
    // ---------------------------------------------------------------

    setStep("results");
  } catch (e) {
    console.error(e);

    setError(
      e.isWalletFetchError || e.message
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
        allRows: allTransactionRows,
        reconciliation,
        narrative,
        discrepancies,
        insights,
      });

      setReportHash(hash);

      const existingLocalRecord = localStorage.getItem(`chaintds_report_${hash}`);
      const existingAnchor = existingLocalRecord ? JSON.parse(existingLocalRecord) : null;
      const anchorResult = existingAnchor
        ? existingAnchor
        : isChainConfigured
          ? await anchorReportOnChain(hash)
          : mockAnchorOnChain(hash);

      setAnchor(anchorResult);

      if (!existingAnchor) {
        localStorage.setItem(
          `chaintds_report_${hash}`,
          JSON.stringify({ ...anchorResult, reportHash: hash })
        );
      }

      // Register this report as a case for the Auditor / Regulator dashboards.
      // The blockchain anchor is already durable at this point, so a database
      // save failure must not hide the successfully generated hash/tx from the
      // taxpayer. The report page below remains available and shows the save
      // warning; the backend case can be retried without resubmitting this
      // blockchain transaction.
      //
      // Persist walletAnalyses inside reconciliation JSONB (existing column) and
      // as a top-level case field so CaseDetail can enrich pending-review evidence
      // the same way the taxpayer dashboard does.
      const walletAnalysesForCase = walletAnalyses;
      const reconciliationForCase = {
        ...reconciliation,
        walletAnalyses: walletAnalysesForCase,
      };
      let caseSaveError = "";
      try {
        await upsertCase({
          id: hash,
          exchanges: exchanges.map((ex) => ex.name.trim()),
          wallets: wallets.filter((w) => w.address.trim()).map((w) => w.address.trim()),
          allRows: allTransactionRows,
          reconciliation: reconciliationForCase,
          walletAnalyses: walletAnalysesForCase,
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
      } catch (caseErr) {
        console.error("Report was anchored but could not be saved as a case:", caseErr);
        caseSaveError = caseErr.message || "The report could not be saved to the T-REX case database.";
      }

      const verifyUrl = `${window.location.origin}${window.location.pathname}#/verify/${hash}`;
      const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });
      setQrDataUrl(qr);
      setError(
        existingAnchor
          ? `This report's hash was already generated: ${hash}`
          : caseSaveError
      );
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
    <div className="app app-wide">
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
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => analyzeWallet(w.id)}
                        disabled={walletAnalyzing[w.id] || !w.address.trim()}
                      >
                        {walletAnalyzing[w.id] ? "Analyzing..." : "Analyze on-chain"}
                      </button>
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
                  {SUPPORTED_WALLET_CHAINS[0].label} is supported for live on-chain analysis.
                  T-REX fetches observable transfers from the blockchain and enriches addresses
                  with MetaSleuth when the backend API key is configured.
                </p>

                {Object.entries(walletAnalyses).map(([walletId, analysis]) => {
                  const rootNode = analysis.provenance?.nodes?.find(
                    (node) => node.address.toLowerCase() === analysis.wallet.toLowerCase()
                  );
                  return (
                    <div className="wallet-analysis-card" key={walletId}>
                      <div className="wallet-analysis-head">
                        <div>
                          <div className="eyebrow">ON-CHAIN PROVENANCE</div>
                          <h3>{analysis.chain?.name || "Ethereum Mainnet"}</h3>
                          <code>{analysis.wallet}</code>
                        </div>
                        <div className="wallet-risk-badge">
                          Risk {rootNode?.riskScore ?? "—"}
                        </div>
                      </div>

                      <div className="wallet-analysis-stats">
                        <div><span>Raw transfers</span><strong>{Number(analysis.traceability?.rawTransferCount ?? analysis.transferCount ?? 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Accounted</span><strong>{Number(analysis.traceability?.accountedTransferCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Verified</span><strong>{Number(analysis.traceability?.verifiedRecordCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Estimated value</span><strong>{Number(analysis.traceability?.estimatedValueRecordCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>DEX events</span><strong>{Number(analysis.traceability?.reconstructedEventCount ?? analysis.derivedDexEventCount ?? 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Compliance rows</span><strong>{Number(analysis.traceability?.complianceRowCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Excluded</span><strong>{Number(analysis.traceability?.excludedTransferCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Pending review</span><strong>{Number(analysis.traceability?.pendingReviewCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Unmatched</span><strong>{Number(analysis.traceability?.unmatchedTransferCount || 0).toLocaleString("en-IN")}</strong></div>
                        <div><span>Counterparties</span><strong>{analysis.provenance?.counterparties?.length || 0}</strong></div>
                        <div>
  <span>MetaSleuth</span>
  <strong>
    {analysis.enrichment?.status === "live"
      ? "Live"
      : analysis.enrichment?.status === "partial"
        ? "Partial"
        : analysis.enrichment?.status === "rate_limited"
          ? "Rate limited"
          : "Not configured"}
  </strong>
</div>
                      </div>

                      <p className="muted small">{analysis.provenance?.note}</p>

                      <div className="wallet-flow-list">
                        {(analysis.provenance?.edges || []).slice(0, 12).map((edge) => {
                          const counterparty = edge.direction === "IN" ? edge.from : edge.to;
                          const node = analysis.provenance?.nodes?.find(
                            (n) => n.address.toLowerCase() === counterparty.toLowerCase()
                          );
                          return (
                            <div className="wallet-flow-row" key={`${edge.txHash}-${edge.from}-${edge.to}`}>
                              <div>
                                <strong>{edge.direction === "IN" ? "IN" : "OUT"}</strong>
                                <span>{edge.amount} {edge.asset}</span>
                              </div>
                              <div className="wallet-flow-path">
                                <code>{edge.direction === "IN" ? edge.from : analysis.wallet}</code>
                                <span>→</span>
                                <code>{edge.direction === "IN" ? analysis.wallet : edge.to}</code>
                              </div>
                              <div className="wallet-flow-label">
                                <strong>{node?.entity || node?.nameTag || "UNKNOWN"}</strong>
                                <span>Risk {node?.riskScore ?? "—"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="wallet-enrichment-note">
                        {analysis.enrichment?.note}
                      </div>

                      {(analysis.derivedTransactions?.length || analysis.derivedLiquidityEvents?.length || analysis.derivedLiquidityPositions?.length) > 0 && (
                        <div className="wallet-dex-evidence">
                          <h4>DEX evidence</h4>
                          {(analysis.derivedTransactions || []).map((event) => {
                            const reconstruction = event.reconstruction || {};
                            const metrics = reconstruction.financialMetrics || {};
                            const display = (value) => value == null || value === "" ? "UNKNOWN" : String(value);
                            return (
                              <div className="wallet-dex-event" key={event.refId || event.txHash}>
                                <strong>{reconstruction.kind || event.type || "DEX event"}</strong>
                                <span>Tx: {display(event.txHash)}</span>
                                <span>Pool: {display(reconstruction.poolAddress)}</span>
                                <span>Route: {reconstruction.route?.length
                                  ? reconstruction.route.map((hop) => `${display(hop.tokenIn)} → ${display(hop.tokenOut)}`).join(" | ")
                                  : display(reconstruction.routeStatus)}</span>
                                <span>Price impact: {display(metrics.priceImpact?.status)}{metrics.priceImpact?.value == null ? "" : ` (${metrics.priceImpact.value})`}</span>
                                <span>Trading fee: {display(metrics.tradingFee?.status)}{metrics.tradingFee?.value == null ? "" : ` (${metrics.tradingFee.value})`}</span>
                                <span>Gas: {display(metrics.gasCost?.status)}{metrics.gasCost?.nativeAmount == null ? "" : ` (${metrics.gasCost.nativeAmount} native)`}</span>
                              </div>
                            );
                          })}
                          {(analysis.derivedLiquidityEvents || []).map((event) => (
                            <div className="wallet-dex-event" key={`${event.transactionHash}-${event.logIndex}`}>
                              <strong>{event.eventType || "LIQUIDITY_UNKNOWN"}</strong>
                              <span>Pool: {event.poolAddress || "UNKNOWN"}</span>
                              <span>Provider: {event.providerAddress || "UNKNOWN"}</span>
                              <span>Status: {event.interpretationStatus || "UNKNOWN"}</span>
                              <span>Tx: {event.transactionHash || "UNKNOWN"}</span>
                            </div>
                          ))}
                          {(analysis.derivedLiquidityPositions || []).map((position) => (
                            <div className="wallet-dex-event" key={position.positionId}>
                              <strong>LP position: {position.positionStatus || "UNKNOWN"}</strong>
                              <span>Pool: {position.poolAddress || "UNKNOWN"}</span>
                              <span>Provider: {position.providerAddress || "UNKNOWN"}</span>
                              <span>Add: {position.originatingTransactionHash || "UNKNOWN"}</span>
                              <span>Remove: {position.removalTransactionHash || "UNKNOWN"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

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
                  walletAnalyses={walletAnalyses}
                  role="taxpayer"
                />

                {insights && (
                  <AIInsightsPanel
                    insights={insights}
                    reportContext={{ insights, discrepancies, reconciliation, walletAnalyses }}
                  />
                )}

                <h3>Transaction flow graph</h3>
                <TransactionFlowGraph
                  allRows={allTransactionRows}
                  reconciliation={reconciliation}
                  discrepancies={discrepancies}
                  walletAnalyses={walletAnalyses}
                />

                {Object.keys(walletAnalyses).length > 0 && (
                  <section className="wallet-analysis-results">
                    <h3>Decentralized wallet analysis</h3>
                    <p className="muted small">Raw on-chain movements, reconstructed DEX events, and MetaSleuth enrichment are shown separately from the unified compliance rows.</p>
                    <table className="data-table">
                      <thead>
                        <tr><th>Wallet</th><th>Chain</th><th>Raw transfers</th><th>DEX events</th><th>Compliance rows</th><th>Excluded</th><th>Pending review</th><th>Counterparties</th><th>MetaSleuth</th><th>Risk</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(walletAnalyses).map(([walletId, analysis]) => {
                          const rootNode = analysis.provenance?.nodes?.find(
                            (node) => node.address.toLowerCase() === analysis.wallet.toLowerCase()
                          );
                          return (
                            <tr key={walletId}>
                              <td><code>{analysis.wallet}</code></td>
                              <td>{analysis.chain?.name || "Ethereum Mainnet"}</td>
                              <td>{Number(analysis.traceability?.rawTransferCount ?? analysis.transferCount ?? 0).toLocaleString("en-IN")}</td>
                              <td>{Number(analysis.traceability?.reconstructedEventCount ?? analysis.derivedDexEventCount ?? 0).toLocaleString("en-IN")}</td>
                              <td>{Number(analysis.traceability?.complianceRowCount || 0).toLocaleString("en-IN")}</td>
                              <td>{Number(analysis.traceability?.excludedTransferCount || 0).toLocaleString("en-IN")}</td>
                              <td>{Number(analysis.traceability?.pendingReviewCount || 0).toLocaleString("en-IN")}</td>
                              <td>{analysis.provenance?.counterparties?.length || 0}</td>
                              <td>{analysis.enrichment?.status === "live" ? "Live" : analysis.enrichment?.status === "partial" ? "Partial" : analysis.enrichment?.status === "rate_limited" ? "Rate limited" : "Not configured"}</td>
                              <td>{rootNode?.riskScore ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                )}

                {Object.entries(walletAnalyses).map(([walletId, analysis]) => (
                  <section className="wallet-analysis-results" key={`${walletId}-audit`}>
                    <h3>Transaction-level audit</h3>
                    <p className="muted small">
                      Raw transfers are accounted for separately from fully verified economic events and compliance rows.
                    </p>
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr><th>Transfer</th><th>Asset / amount</th><th>Block</th><th>Linked event</th><th>Status</th><th>Valuation</th><th>Reason</th></tr>
                        </thead>
                        <tbody>
                          {(analysis.traceability?.inventory || []).map((item) => (
                            <tr key={item.rawTransferId}>
                              <td><code>{item.txHash || item.rawTransferId}</code><div className="muted small">{item.direction} · {item.transactionCategory || "unknown"}</div></td>
                              <td>{item.amount == null ? "Unavailable" : `${item.amount} ${item.asset}`}</td>
                              <td>{item.blockNumber || "Unavailable"}</td>
                              <td>{item.linkedEconomicEventId || "None"}</td>
                              <td>{item.status}</td>
                              <td>{item.valuationStatus}</td>
                              <td>{item.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}

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
                reconciliation.unmatchedDeposits.length === 0 &&
                !(Number(reconciliation.walletPendingReviewCount) > 0) ? (
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
                              walletAnalyses,
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

                {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

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
