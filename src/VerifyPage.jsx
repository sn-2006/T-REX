import { useEffect, useState } from "react";
import { isChainConfigured, verifyReportOnChain, verifyCertificateOnChain } from "./utils/blockchain";
import { apiFetch } from "./api/client";

export default function VerifyPage({ hash }) {
  const [status, setStatus] = useState("checking"); // checking | verified | not-found | error | invalid-hash
  const [record, setRecord] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!hash || hash.trim().length !== 64) {
        setStatus("invalid-hash");
        setErrorMsg("Invalid SHA-256 report hash format. Hash must be a 64-character hexadecimal string.");
        return;
      }

      if (isChainConfigured) {
        try {
          const anchorResult = await verifyReportOnChain(hash);
          let certResult = null;
          let certError = null;

          try {
            certResult = await verifyCertificateOnChain(hash);
          } catch (certErr) {
            console.warn("On-chain certificate lookup failed:", certErr);
            certError = certErr.message || "RPC lookup failure";
          }

          if (cancelled) return;

          if (anchorResult.found) {
            setRecord({
              reportHash: hash,
              network: "MST Testnet",
              submitter: anchorResult.submitter,
              timestamp: anchorResult.timestamp,
              onChainCertificate: certResult,
              certError,
            });
            setStatus("verified");
          } else {
            setStatus("not-found");
          }
        } catch (e) {
          if (!cancelled) {
            setErrorMsg(e.message || "Couldn't reach the MST smart contract.");
            setStatus("error");
          }
        }
        return;
      }

      // Fallback: no contract configured yet, check database record
      try {
        const result = await apiFetch(`/verify/${encodeURIComponent(hash)}`, { auth: false });
        if (cancelled) return;
        if (result.found) {
          setRecord(result);
          setStatus("verified");
        } else {
          setStatus("not-found");
        }
      } catch {
        try {
          const raw = localStorage.getItem(`chaintds_report_${hash}`);
          if (cancelled) return;
          if (raw) {
            setRecord(JSON.parse(raw));
            setStatus("verified");
          } else {
            setStatus("not-found");
          }
        } catch {
          if (!cancelled) setStatus("not-found");
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, [hash]);

  const cert = record?.onChainCertificate || (record?.complianceCertificate ? {
    valid: true,
    auditor: record.complianceCertificate.auditorAddress,
    status: record.complianceCertificate.status,
    issuedAt: record.complianceCertificate.issuedAt,
    details: record.complianceCertificate,
  } : null);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">T-REX — Verification</div>
      </header>
      <main className="app-main">
        <section className="card">
          {status === "checking" && <p className="muted">Checking record on MST Testnet...</p>}

          {status === "verified" && record && (
            <>
              <h1>✓ Verified Report Anchor</h1>
              <p className="muted">
                {isChainConfigured
                  ? "This hash is anchored on the MST Testnet smart contract."
                  : "This report's fingerprint matches a record on this device. No contract is configured yet — this is the local fallback, not a real on-chain check."}
              </p>
              <div className="kv"><span>SHA-256</span><code>{record.reportHash}</code></div>
              {record.network && <div className="kv"><span>Network</span><code>{record.network}</code></div>}
              {record.txHash && <div className="kv"><span>Anchor Tx hash</span><code>{record.txHash}</code></div>}
              {record.submitter && <div className="kv"><span>Submitted by</span><code>{record.submitter}</code></div>}
              {record.blockNumber && <div className="kv"><span>Anchor Block</span><code>{record.blockNumber}</code></div>}
              {record.timestamp && <div className="kv"><span>Anchored at</span><code>{record.timestamp}</code></div>}

              {/* MST Compliance Certificate Verification Display */}
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--line)" }}>
                <h2 style={{ fontSize: "18px", margin: "0 0 12px 0" }}>MST Compliance Certificate</h2>

                {record.certError ? (
                  <div className="error" style={{ marginBottom: "12px" }}>
                    ⚠️ Blockchain / RPC Verification Failure: Could not query certificate state ({record.certError}).
                  </div>
                ) : cert && cert.valid ? (
                  <div style={{ padding: "16px", background: "rgba(0, 255, 128, 0.05)", border: "1px solid var(--green)", borderRadius: "8px" }}>
                    <div style={{ color: "var(--green)", fontWeight: "bold", fontSize: "14px", marginBottom: "12px" }}>
                      ✓ ACTIVE & VERIFIED COMPLIANCE CERTIFICATE
                    </div>
                    {cert.details?.certId && <div className="kv"><span>Cert ID</span><code>{cert.details.certId}</code></div>}
                    {cert.auditor && <div className="kv"><span>Auditor Address</span><code>{cert.auditor}</code></div>}
                    <div className="kv"><span>Certificate Status</span><code>{cert.status === 1 ? "1 (Verified)" : cert.status}</code></div>
                    {cert.issuedAt && <div className="kv"><span>Issued At</span><code>{cert.issuedAt}</code></div>}
                    {cert.validUntil && <div className="kv"><span>Valid Until</span><code>{cert.validUntil}</code></div>}
                    {cert.details?.txHash && <div className="kv"><span>Cert Tx Hash</span><code>{cert.details.txHash}</code></div>}
                    {cert.details?.blockNumber && <div className="kv"><span>Cert Block</span><code>{cert.details.blockNumber}</code></div>}
                  </div>
                ) : cert && cert.revoked ? (
                  <div style={{ padding: "16px", background: "rgba(255, 0, 0, 0.05)", border: "1px solid #ff9b9b", borderRadius: "8px" }}>
                    <div style={{ color: "#ff9b9b", fontWeight: "bold", fontSize: "14px", marginBottom: "12px" }}>
                      ❌ COMPLIANCE CERTIFICATE REVOKED
                    </div>
                    {cert.auditor && <div className="kv"><span>Auditor Address</span><code>{cert.auditor}</code></div>}
                    {cert.details?.revocationReason && (
                      <div className="kv"><span>Revocation Reason</span><code>{cert.details.revocationReason}</code></div>
                    )}
                  </div>
                ) : (
                  <p className="muted small" style={{ margin: 0 }}>
                    No on-chain auditor compliance certificate has been issued for this report hash yet.
                  </p>
                )}
              </div>
            </>
          )}

          {status === "not-found" && (
            <>
              <h1>No record found</h1>
              <p className="muted">
                {isChainConfigured
                  ? "This hash hasn't been anchored on the contract."
                  : "No report matching this hash was found."}
              </p>
            </>
          )}

          {status === "invalid-hash" && (
            <>
              <h1>Invalid Report Hash</h1>
              <p className="muted">{errorMsg}</p>
            </>
          )}

          {status === "error" && (
            <>
              <h1>Couldn't verify</h1>
              <p className="muted">⚠️ Blockchain / Network / RPC Failure: {errorMsg}</p>
            </>
          )}

          <button className="link-btn" onClick={() => { window.location.hash = ""; }} style={{ marginTop: "24px" }}>
            Back to T-REX
          </button>
        </section>
      </main>
    </div>
  );
}

