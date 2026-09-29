import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import { casesForTaxpayer } from "../../data/caseStore";
import DashboardHeader from "../../components/DashboardHeader";
import {
  authorizeReportAccess,
  createReportPaymentRequest,
  getReportAccessStatus,
  getReportReleaseContext,
  revokeReportAccess,
  submitWrappedReportDek,
} from "../../api/reportAccess.js";
import {
  getClientKeyPairById,
  importAuditorPublicKey,
  wrapReportDekForAuditor,
} from "../../utils/reportCrypto.js";

export default function ReconciliationHistory({ session, onLogout }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verifyingCase, setVerifyingCase] = useState(null);
  const [auditors, setAuditors] = useState([]);
  const [selectedAuditor, setSelectedAuditor] = useState("");
  const [verifySending, setVerifySending] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [accessStatuses, setAccessStatuses] = useState({});
  const [accessMessages, setAccessMessages] = useState({});
  const [payments, setPayments] = useState({});

  function isCasePaid(caseId) {
    if (payments[caseId]?.status === "paid") return true;
    const status = accessStatuses[caseId]?.payment;
    return status === "verified" || status === "paid" || status === "not_required";
  }

  function handlePaymentMethodSelect(caseId, method) {
    if (!method) return;
    setPayments((prev) => ({
      ...prev,
      [caseId]: { status: "paid", method },
    }));
  }

  async function refreshAccessStatus(caseId) {
    const status = await getReportAccessStatus(caseId);
    setAccessStatuses((current) => ({ ...current, [caseId]: status }));
    return status;
  }

  useEffect(() => {
    async function fetchAuditors() {
      try {
        const data = await apiFetch("/auditors");
        setAuditors(data);
        if (data.length > 0) setSelectedAuditor(data[0].id);
      } catch (err) {
        console.error(err);
      }
    }
    fetchAuditors();
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await casesForTaxpayer();
        setCases(data);
        const statuses = await Promise.all(data.map(async (item) => {
          try {
            return [item.id, await getReportAccessStatus(item.id)];
          } catch {
            return [item.id, null];
          }
        }));
        setAccessStatuses(Object.fromEntries(statuses));
      } catch (err) {
        setError(err.message || "Couldn't load reconciliation history.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function performAutomaticKeyRelease(caseId, targetAuditorId) {
    const reportCase = cases.find((item) => item.id === caseId);
    if (!reportCase?.encryptedReport) return;
    try {
      const context = await getReportReleaseContext(caseId, targetAuditorId);
      const taxpayerKey = await getClientKeyPairById(reportCase.encryptedReport.recipientKeyId);
      const auditorPublicKey = await importAuditorPublicKey(context.publicKeySpki);
      const wrappedRelease = await wrapReportDekForAuditor({
        encryptedReport: reportCase.encryptedReport,
        taxpayerPrivateKey: taxpayerKey.privateKey,
        auditorPublicKey,
        auditorKeyId: context.auditorKeyId,
      });
      await submitWrappedReportDek(caseId, targetAuditorId, {
        permit: context.permit,
        auditorKeyId: wrappedRelease.auditorKeyId,
        wrappedDek: wrappedRelease.wrappedDek,
      });
    } catch (releaseErr) {
      console.warn("Automatic key release warning:", releaseErr?.message || releaseErr);
    }
  }

  async function handleAccessAction(caseId, action) {
    const status = accessStatuses[caseId];
    if (!status?.auditor?.id) return;
    setAccessMessages((current) => ({ ...current, [caseId]: "Updating access state..." }));
    try {
      let result;
      if (action === "authorize") result = await authorizeReportAccess(caseId, status.auditor.id);
      if (action === "revoke") result = await revokeReportAccess(caseId, status.auditor.id);
      if (action === "payment") result = await createReportPaymentRequest(caseId);
      if (action === "release") {
        await performAutomaticKeyRelease(caseId, status.auditor.id);
        result = { message: "Report key released to auditor." };
      }
      await refreshAccessStatus(caseId);
      setAccessMessages((current) => ({
        ...current,
        [caseId]: result?.message || "Access state updated.",
      }));
    } catch (err) {
      setAccessMessages((current) => ({ ...current, [caseId]: err.message || "Could not update access state." }));
    }
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Taxpayer dashboard" onLogout={onLogout} />
      <main className="app-main">
        <section className="card">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => (window.location.hash = "#/taxpayer")}
            style={{ marginBottom: "24px" }}
          >
            ← Back to Dashboard
          </button>

          <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "var(--paper)" }}>
            Reconciliation & Verification
          </h1>
          <p className="muted" style={{ marginBottom: "24px" }}>
            View your past reconciliation reports, their status, and their anchored SHA-256 hashes.
          </p>

          {loading && <p className="muted">Loading history...</p>}

          {error && <div className="error">{error}</div>}

          {!loading && !error && cases.length === 0 && (
            <p className="muted">You have no past reconciliations on record.</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {cases.map((c) => (
              <div
                key={c.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "8px",
                  padding: "16px",
                  background: "rgba(255,255,255,0.02)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>
                      Report from {new Date(c.createdAt).toLocaleDateString()}
                    </h3>
                    <span className="muted" style={{ fontSize: "12px" }}>
                      {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: "bold",
                      border: "1px solid",
                      borderColor: c.status === "verified" ? "var(--green)" : c.status === "high-risk" || c.status === "flagged" ? "#ff9b9b" : "rgba(255,255,255,0.2)",
                      color: c.status === "verified" ? "var(--green)" : c.status === "high-risk" || c.status === "flagged" ? "#ff9b9b" : "var(--paper)",
                    }}
                  >
                    {c.status.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}>
                    <span className="muted">Sources:</span>
                    <span>{c.exchanges?.join(", ")} {c.wallets?.length > 0 && `(+ ${c.wallets.length} wallets)`}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}>
                    <span className="muted">Discrepancies:</span>
                    <span>{c.discrepancies?.length || 0} found</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}>
                    <span className="muted">SHA-256 Hash:</span>
                    <span style={{ fontFamily: "monospace", color: "var(--green)" }}>
                      {c.reportHash?.slice(0, 16)}...{c.reportHash?.slice(-16)}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: "16px", padding: "12px", border: "1px solid var(--line)", borderRadius: "6px" }}>
                  <strong>Auditor access</strong>
                  <div className="muted small" style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
                    <span>Auditor request: {accessStatuses[c.id]?.auditorRequest || (c.auditorId ? "Assigned" : "Not requested")}</span>
                    <span>Payment: {isCasePaid(c.id) ? (payments[c.id]?.method ? `Paid (${payments[c.id].method})` : "Paid") : (accessStatuses[c.id]?.payment || "Pending")}</span>
                    <span>Authorization: {accessStatuses[c.id]?.authorization || "Pending"}</span>
                    {accessStatuses[c.id]?.auditor?.name && <span>Auditor: {accessStatuses[c.id].auditor.name}</span>}
                    <span>Report Status: {accessStatuses[c.id]?.report || "Locked"}</span>
                  </div>
                  {accessStatuses[c.id]?.auditor && accessStatuses[c.id]?.auditorRequest === "Accepted" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                      <button className="secondary-btn" onClick={() => refreshAccessStatus(c.id)}>
                        Refresh status
                      </button>
                      {accessStatuses[c.id].authorization === "approved" && (
                        <button className="secondary-btn danger" onClick={() => handleAccessAction(c.id, "revoke")}>
                          Revoke access
                        </button>
                      )}
                    </div>
                  )}
                  {accessMessages[c.id] && <p className="muted small" role="status">{accessMessages[c.id]}</p>}
                </div>

                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button
                    className="secondary-btn"
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                    onClick={() => {
                      setVerifyingCase(c.id);
                    }}
                  >
                    Verify with Auditor
                  </button>
                  <button
                    className="primary-btn"
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                    onClick={() => {
                      window.location.hash = `#/verify/${c.reportHash}`;
                    }}
                  >
                    View Full Report
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {verifyingCase && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: "440px", width: "100%", padding: "24px" }}>
            <h2 style={{ marginTop: 0, fontSize: "20px", color: "var(--paper)" }}>Verify with Auditor</h2>
            <p className="muted" style={{ fontSize: "14px", marginBottom: "16px" }}>
              Select an auditor and complete payment to submit and release your compliance report.
            </p>
            {verifyError && <div className="error" style={{ marginBottom: "16px" }}>{verifyError}</div>}
            
            {/* STEP 1: AUDITOR SELECTION */}
            <div style={{ marginBottom: "20px" }}>
              <label className="field-label" style={{ display: "block", marginBottom: "6px", fontSize: "12px" }}>
                1. Select Auditor
              </label>
              <select
                value={selectedAuditor}
                onChange={(e) => setSelectedAuditor(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "var(--input-bg, #080a09)",
                  color: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: "8px"
                }}
              >
                <option value="" disabled>Select an auditor...</option>
                {auditors.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.externalId})</option>
                ))}
              </select>
            </div>

            {/* STEP 2: PAYMENT METHOD SELECTION */}
            <div style={{ opacity: selectedAuditor ? 1 : 0.5, pointerEvents: selectedAuditor ? "auto" : "none" }}>
              {!isCasePaid(verifyingCase) ? (
                <div style={{
                  marginBottom: "20px",
                  padding: "16px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--line)",
                  borderRadius: "8px"
                }}>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "15px", color: "var(--paper)", fontWeight: "600" }}>
                    2. Payment Required
                  </h3>
                  <p className="muted" style={{ margin: "0 0 12px 0", fontSize: "13px" }}>
                    Complete payment to proceed with automatic key release.
                  </p>

                  <label className="field-label" style={{ display: "block", marginBottom: "6px", fontSize: "12px" }}>
                    Select Payment Method
                  </label>
                  <select
                    value={payments[verifyingCase]?.method || ""}
                    onChange={(e) => handlePaymentMethodSelect(verifyingCase, e.target.value)}
                    disabled={!selectedAuditor}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--input-bg, #080a09)",
                      color: "var(--paper)",
                      border: "1px solid var(--line)",
                      borderRadius: "6px",
                      fontSize: "14px"
                    }}
                  >
                    <option value="" disabled>Select Payment Method ▾</option>
                    <option value="Google Pay">Google Pay</option>
                    <option value="UPI">UPI</option>
                    <option value="Credit / Debit Card">Credit / Debit Card</option>
                  </select>
                </div>
              ) : (
                <div style={{
                  marginBottom: "20px",
                  padding: "14px 16px",
                  background: "rgba(124, 151, 116, 0.12)",
                  border: "1px solid var(--green)",
                  borderRadius: "8px"
                }}>
                  <div style={{ color: "var(--green)", fontWeight: "bold", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <span>✓</span> Payment Successful
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--paper)", marginBottom: "2px" }}>
                    Payment Method: <strong>{payments[verifyingCase]?.method || "UPI"}</strong>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--paper)" }}>
                    Status: <strong style={{ color: "var(--green)" }}>Paid</strong>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button className="secondary-btn" onClick={() => { setVerifyingCase(null); setVerifyError(""); }}>Cancel</button>
              <button
                className="primary-btn"
                disabled={!isCasePaid(verifyingCase) || !selectedAuditor || verifySending}
                onClick={async () => {
                  setVerifySending(true);
                  setVerifyError("");
                  try {
                    const targetMethod = payments[verifyingCase]?.method || "UPI";
                    await apiFetch(`/cases/${verifyingCase}/submit`, {
                      method: "POST",
                      body: {
                        auditorId: selectedAuditor,
                        paymentMethod: targetMethod,
                      }
                    });

                    // Automatically release report key to the selected auditor
                    await performAutomaticKeyRelease(verifyingCase, selectedAuditor);
                    
                    setVerifyingCase(null);
                    // Reload cases to reflect status update
                    const data = await casesForTaxpayer();
                    setCases(data);
                    await refreshAccessStatus(verifyingCase);
                  } catch (err) {
                    setVerifyError(err.message);
                  } finally {
                    setVerifySending(false);
                  }
                }}
              >
                {verifySending ? "Processing..." : "Send Request & Release Key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
