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
        const reportCase = cases.find((item) => item.id === caseId);
        if (!reportCase?.encryptedReport) throw new Error("Encrypted report metadata is unavailable.");
        const context = await getReportReleaseContext(caseId, status.auditor.id);
        const taxpayerKey = await getClientKeyPairById(reportCase.encryptedReport.recipientKeyId);
        const auditorPublicKey = await importAuditorPublicKey(context.publicKeySpki);
        const wrappedRelease = await wrapReportDekForAuditor({
          encryptedReport: reportCase.encryptedReport,
          taxpayerPrivateKey: taxpayerKey.privateKey,
          auditorPublicKey,
          auditorKeyId: context.auditorKeyId,
        });
        result = await submitWrappedReportDek(caseId, status.auditor.id, {
          permit: context.permit,
          auditorKeyId: wrappedRelease.auditorKeyId,
          wrappedDek: wrappedRelease.wrappedDek,
        });
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
                    <span>Payment: {accessStatuses[c.id]?.payment || "Pending"}</span>
                    <span>Authorization: {accessStatuses[c.id]?.authorization || "Pending"}</span>
                    {accessStatuses[c.id]?.auditor?.name && <span>Auditor: {accessStatuses[c.id].auditor.name}</span>}
                  </div>
                  {accessStatuses[c.id]?.auditor && accessStatuses[c.id]?.auditorRequest === "Accepted" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                      {accessStatuses[c.id].authorization !== "approved" && (
                        <button className="secondary-btn" onClick={() => handleAccessAction(c.id, "authorize")}>
                          Authorize report access
                        </button>
                      )}
                      {accessStatuses[c.id].authorization === "approved" && accessStatuses[c.id].payment === "pending" && (
                        <button className="secondary-btn" onClick={() => handleAccessAction(c.id, "payment")}>
                          Create payment request
                        </button>
                      )}
                      {accessStatuses[c.id].authorization === "approved" &&
                        accessStatuses[c.id].certificate === "Verified" &&
                        ["verified", "not_required"].includes(accessStatuses[c.id].payment) &&
                        accessStatuses[c.id].report === "Locked" && (
                          <button className="primary-btn" onClick={() => handleAccessAction(c.id, "release")}>
                            Release report key to auditor
                          </button>
                        )}
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
          <div className="card" style={{ maxWidth: "400px", width: "100%" }}>
            <h2 style={{ marginTop: 0 }}>Verify with Auditor</h2>
            <p className="muted">Select an auditor to review this report.</p>
            {verifyError && <div className="error" style={{ marginBottom: "16px" }}>{verifyError}</div>}
            
            <select
              value={selectedAuditor}
              onChange={(e) => setSelectedAuditor(e.target.value)}
              style={{
                width: "100%", padding: "12px", background: "var(--input-bg)", color: "var(--paper)", border: "1px solid var(--line)", borderRadius: "8px", marginBottom: "24px"
              }}
            >
              <option value="" disabled>Select an auditor...</option>
              {auditors.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.externalId})</option>
              ))}
            </select>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button className="secondary-btn" onClick={() => { setVerifyingCase(null); setVerifyError(""); }}>Cancel</button>
              <button
                className="primary-btn"
                disabled={!selectedAuditor || verifySending}
                onClick={async () => {
                  setVerifySending(true);
                  setVerifyError("");
                  try {
                    await apiFetch(`/cases/${verifyingCase}/submit`, {
                      method: "POST",
                      body: { auditorId: selectedAuditor }
                    });
                    
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
                {verifySending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
