import { useEffect, useState } from "react";
import {
  casesForAuditor,
  updateCaseStatus,
} from "../data/caseStore";
import DashboardHeader from "../components/DashboardHeader";
import CaseDetail from "../components/CaseDetail";
import PowerBIAnalytics from "../components/PowerBIAnalytics";
import AuditorKeySetup from "../components/AuditorKeySetup";
import {
  decryptReleasedReport,
  getClientKeyPairById,
  getOrCreateClientKeyPair,
} from "../utils/reportCrypto.js";
import {
  getReleasedReport,
  getReportAccessStatus,
  recordReportAccess,
  requestReportAccess,
} from "../api/reportAccess.js";
import {
  isChainConfigured,
  issueCertificateOnChain,
  mockIssueCertificateOnChain,
} from "../utils/blockchain.js";

const TABS = [
  { key: "all", label: "All" },
  { key: "not-touched", label: "Not touched" },
  { key: "pending", label: "Pending" },
  { key: "high-risk", label: "High risk" },
  { key: "verified", label: "Verified" },
  { key: "flagged", label: "Flagged" },
];

const STATUS_LABEL = {
  pending: "pending review",
  "high-risk": "flagged as high risk",
  verified: "verified",
  flagged: "flagged for follow-up",
};

export default function AuditorDashboard({ session, onLogout, initialView = "cases" }) {
  const [showSecuritySettings, setShowSecuritySettings] = useState(initialView === "security");
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [accessStatus, setAccessStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [releasedReport, setReleasedReport] = useState(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [requestingReport, setRequestingReport] = useState(false);
  const [requestError, setRequestError] = useState("");

  // Ensure auditor client key pair is generated and saved in browser IndexedDB in background
  useEffect(() => {
    if (session?.id) {
      getOrCreateClientKeyPair(`auditor:${session.id}`).catch(() => {});
    }
  }, [session?.id]);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAccessStatus(null);
    setReleasedReport(null);
    setReleaseError("");
    setRequestError("");
    if (!selectedId) return undefined;
    setStatusLoading(true);
    getReportAccessStatus(selectedId)
      .then((status) => {
        if (cancelled) return;
        setAccessStatus(status);
        if (status.report !== "Available") setReleasedReport(null);
      })
      .catch((err) => {
        if (!cancelled) setReleaseError(err.message || "Could not load report access status.");
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered =
    tab === "all"
      ? cases
      : tab === "not-touched"
      ? cases.filter((c) => !c.reviewedAt)
      : cases.filter((c) => c.status === tab);

  const selected = cases.find((c) => c.id === selectedId) || null;

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const assigned = await casesForAuditor();
      setCases(assigned);
    } catch (e) {
      setError(e.message || "Couldn't load cases.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(note) {
    if (!selected) return;

    const reportHash = selected.reportHash || selected.id;
    const taxpayerAddress =
      Array.isArray(selected.wallets) && selected.wallets.length > 0
        ? selected.wallets[0]
        : null;

    setActionMessage(
      "Connecting BridgeKey wallet & issuing MST Compliance Certificate on-chain..."
    );

    let certResult;
    try {
      if (isChainConfigured) {
        certResult = await issueCertificateOnChain({
          reportHashHex: reportHash,
          taxpayerAddress,
          status: 1, // 1 = Verified
          validUntil: 0,
        });
      } else {
        const allowMock =
          (typeof import.meta !== "undefined" && import.meta.env?.VITE_ALLOW_MOCK_CHAIN === "true") ||
          process.env.VITE_ALLOW_MOCK_CHAIN === "true";
        if (allowMock) {
          certResult = mockIssueCertificateOnChain(reportHash);
        } else {
          throw new Error("MST Compliance Certificate contract is not configured (VITE_CONTRACT_ADDRESS is missing). On-chain certificate issuance cannot proceed.");
        }
      }
    } catch (certError) {
      console.error("MST Compliance Certificate issuance failed:", certError);
      setActionMessage(
        `❌ Compliance Certificate issuance failed: ${
          certError.message || "Wallet transaction was rejected or failed."
        } The case was NOT marked as verified.`
      );
      throw certError;
    }

    // ONLY AFTER the on-chain certificate transaction succeeds:
    await updateCaseStatus(selected.id, "verified", note, certResult);
    setActionMessage(
      `✓ MST Compliance Certificate issued on-chain (Tx: ${certResult.txHash.slice(
        0,
        10
      )}...). ${selected.taxpayerName}'s case has been marked as verified.`
    );
    refresh();
  }

  async function handleFlag(note) {
    if (!selected) return;

    await updateCaseStatus(selected.id, "flagged", note);
    setActionMessage(
      `${selected.taxpayerName}'s case has been marked as flagged.`
    );
    refresh();
  }

  async function handleRequestReport() {
    if (!selected) return;
    setRequestingReport(true);
    setRequestError("");
    try {
      await requestReportAccess(selected.id);
      const status = await getReportAccessStatus(selected.id);
      setAccessStatus(status);
      setActionMessage("Report access requested. You can now discuss details with the taxpayer.");
    } catch (err) {
      setRequestError(err.message || "Could not request report access.");
    } finally {
      setRequestingReport(false);
    }
  }

  function handleOpenConversation() {
    if (accessStatus?.conversationId) {
      window.location.hash = `#/auditor/conversations/${accessStatus.conversationId}`;
    } else {
      window.location.hash = "#/auditor/chats";
    }
  }

  async function handleDecryptAndView() {
    if (!selected || accessStatus?.report !== "Available") return;
    setReleaseLoading(true);
    setReleaseError("");
    try {
      const { encryptedReport, release } = await getReleasedReport(selected.id);
      const keyPair = await getClientKeyPairById(release.auditorKeyId);
      const report = await decryptReleasedReport({
        encryptedReport,
        release,
        auditorPrivateKey: keyPair.privateKey,
        expectedHash: selected.reportHash,
      });
      await recordReportAccess(selected.id);
      setReleasedReport(report);
    } catch (error) {
      setReleaseError(error.message || "Could not decrypt and verify this report.");
    } finally {
      setReleaseLoading(false);
    }
  }

  function handleStatusPillClick(e, c) {
    e.stopPropagation();
    window.alert(
      `${c.taxpayerName}'s case is ${
        STATUS_LABEL[c.status] || c.status
      }.`
    );
  }

  const counts = {
    all: cases.length,
    "not-touched": cases.filter((c) => !c.reviewedAt).length,
    pending: cases.filter((c) => c.status === "pending").length,
    "high-risk": cases.filter((c) => c.status === "high-risk").length,
    verified: cases.filter((c) => c.status === "verified").length,
    flagged: cases.filter((c) => c.status === "flagged").length,
  };

  // Determine which of the 4 access flow states applies
  const isBeforeRequest =
    !accessStatus?.auditorRequest || accessStatus.auditorRequest === "Not requested";
  const isAccessRequested =
    Boolean(accessStatus?.auditorRequest && accessStatus.auditorRequest !== "Not requested") &&
    accessStatus?.payment !== "verified" &&
    accessStatus?.payment !== "not_required";
  const isWaitingTaxpayerApproval =
    (accessStatus?.payment === "verified" || accessStatus?.payment === "not_required") &&
    accessStatus?.report !== "Available";
  const isReleaseReady = accessStatus?.report === "Available";

  return (
    <div className="app app-wide">
      <DashboardHeader
        session={session}
        roleLabel="Auditor dashboard"
        onLogout={onLogout}
      />

      <main className="app-main">
        {showSecuritySettings ? (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => setShowSecuritySettings(false)}
              >
                ← Back to case list
              </button>
              <span className="muted small">Auditor Security & Certificate Settings</span>
            </div>
            <AuditorKeySetup session={session} />
          </section>
        ) : !selected ? (
          <>
            {/* ASSIGNED CASES */}
            <section className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <h1 style={{ margin: "0 0 8px 0" }}>Assigned taxpayer cases</h1>
                  <p className="muted" style={{ margin: 0 }}>
                    Cases reconciled and submitted by taxpayers, assigned to you for review.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowSecuritySettings(true)}
                  style={{ whiteSpace: "nowrap", padding: "8px 14px", fontSize: "13px" }}
                  title="Configure external CA certificate & key identity"
                >
                  ⚙ Security Settings
                </button>
              </div>

              {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}

              {loading && <p className="muted" style={{ marginTop: 16 }}>Loading cases...</p>}

              {actionMessage && (
                <div className="action-banner" style={{ marginTop: 16 }}>
                  {actionMessage}
                  <button
                    className="link-btn"
                    onClick={() => setActionMessage("")}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <PowerBIAnalytics
                cases={cases}
                discrepancies={cases.flatMap((c) => c.discrepancies || [])}
                role="auditor"
              />

              <div className="tab-row">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    className={`tab-btn ${tab === t.key ? "active" : ""}`}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label} <span className="tab-count">{counts[t.key]}</span>
                  </button>
                ))}
              </div>

              <div className="case-list">
                {filtered.length === 0 && (
                  <p className="muted">No cases in this category yet.</p>
                )}

                {filtered.map((c) => (
                  <button
                    key={c.id}
                    className="case-row"
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div>
                      <strong>{c.taxpayerName}</strong>
                      <span className="muted small"> · PAN {c.panMasked}</span>
                      <div className="muted small">{c.exchanges.join(", ")}</div>
                    </div>

                    <div className="case-row-right">
                      <span className="muted small">
                        {c.encryptedReport ? "Encrypted report" : "Legacy report locked"}
                      </span>
                      <span
                        className={`case-status-pill case-status-${c.status}`}
                        onClick={(e) => handleStatusPillClick(e, c)}
                        title="Click for what this status means"
                      >
                        {c.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          /* CASE DETAIL */
          <section className="card">
            <button
              className="link-btn"
              onClick={() => {
                setSelectedId(null);
                setActionMessage("");
                setReleasedReport(null);
                setReleaseError("");
              }}
              style={{ marginBottom: 16 }}
            >
              ← Back to case list
            </button>

            {actionMessage && (
              <div className="action-banner" style={{ marginBottom: 16 }}>
                {actionMessage}
                <button
                  className="link-btn"
                  onClick={() => setActionMessage("")}
                >
                  Dismiss
                </button>
              </div>
            )}

            {releasedReport ? (
              <>
                <div className="integrity-verified-banner">
                  <span className="icon">✓</span>
                  <span>Integrity: SHA-256 verified against the report hash.</span>
                </div>
                <CaseDetail case_={releasedReport} onApprove={handleApprove} onFlag={handleFlag} />
              </>
            ) : (
              <div className="report-access-container">
                <div className="report-lock-card">
                  <div className="report-lock-card-header">
                    <h2>Compliance Report</h2>
                    <span className="report-hash-pill" title={`SHA-256: ${selected.reportHash}`}>
                      {selected.reportHash ? `${selected.reportHash.slice(0, 10)}...${selected.reportHash.slice(-8)}` : "Report"}
                    </span>
                  </div>

                  {statusLoading ? (
                    <p className="muted" style={{ margin: "24px 0" }}>Checking report access status...</p>
                  ) : isBeforeRequest ? (
                    /* BEFORE REQUEST */
                    <div className="report-flow-stage">
                      <div className="report-status-badge locked">
                        <span className="badge-icon">🔒</span>
                        <span>Report Locked</span>
                      </div>
                      <p className="report-flow-prompt">Request access to this report.</p>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={handleRequestReport}
                        disabled={requestingReport}
                      >
                        {requestingReport ? "Requesting..." : "Request Report"}
                      </button>
                      {requestError && <p className="error" role="alert" style={{ marginTop: 12 }}>{requestError}</p>}
                    </div>
                  ) : isAccessRequested ? (
                    /* AFTER REQUEST: NEGOTIATION / PAYMENT PENDING */
                    <div className="report-flow-stage">
                      <div className="report-status-badge requested">
                        <span className="badge-icon">🕐</span>
                        <span>Access Requested</span>
                      </div>
                      <p className="report-flow-prompt">Discuss the fee with the taxpayer.</p>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={handleOpenConversation}
                      >
                        Open Conversation
                      </button>
                    </div>
                  ) : isWaitingTaxpayerApproval ? (
                    /* AFTER PAYMENT: WAITING FOR TAXPAYER APPROVAL */
                    <div className="report-flow-stage">
                      <div className="report-status-stack">
                        <div className="report-step-pill success">
                          <span className="pill-check">✓</span>
                          <span>Payment Verified</span>
                        </div>
                        <div className="report-step-pill pending">
                          <span className="pill-icon">⏳</span>
                          <span>Waiting for Taxpayer Approval</span>
                        </div>
                      </div>
                      <p className="muted small" style={{ marginTop: 16 }}>
                        The taxpayer has been notified to approve access and securely release the report key.
                      </p>
                    </div>
                  ) : isReleaseReady ? (
                    /* ALL GATES PASSED: SECURE RELEASE READY */
                    <div className="report-flow-stage">
                      <div className="report-status-stack">
                        <div className="report-step-pill success">
                          <span className="pill-check">✓</span>
                          <span>Access Approved</span>
                        </div>
                        <div className="report-step-pill success">
                          <span className="pill-check">✓</span>
                          <span>Payment Verified</span>
                        </div>
                        <div className="report-step-pill success">
                          <span className="pill-check">✓</span>
                          <span>Secure Release Ready</span>
                        </div>
                      </div>
                      <div style={{ marginTop: 24 }}>
                        <button
                          type="button"
                          className="primary-btn view-report-btn"
                          onClick={handleDecryptAndView}
                          disabled={releaseLoading}
                        >
                          {releaseLoading ? "Opening Report..." : "View Report"}
                        </button>
                      </div>
                      {releaseError && <p className="error" role="alert" style={{ marginTop: 12 }}>{releaseError}</p>}
                    </div>
                  ) : (
                    /* FALLBACK LOCKED */
                    <div className="report-flow-stage">
                      <div className="report-status-badge locked">
                        <span className="badge-icon">🔒</span>
                        <span>Report Locked</span>
                      </div>
                      <p className="muted small" style={{ marginTop: 16 }}>
                        {accessStatus?.authorization === "revoked"
                          ? "Access to this report has been revoked by the taxpayer."
                          : "Access to this report is locked."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}