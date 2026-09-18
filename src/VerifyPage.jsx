import { useEffect, useState } from "react";
import { isChainConfigured, verifyReportOnChain } from "./utils/blockchain";

export default function VerifyPage({ hash }) {
  const [status, setStatus] = useState("checking"); // checking | verified | not-found | error
  const [record, setRecord] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (isChainConfigured) {
        try {
          const result = await verifyReportOnChain(hash);
          if (cancelled) return;
          if (result.found) {
            setRecord({
              reportHash: hash,
              network: "Polygon Amoy",
              submitter: result.submitter,
              timestamp: result.timestamp,
            });
            setStatus("verified");
          } else {
            setStatus("not-found");
          }
        } catch (e) {
          if (!cancelled) {
            setErrorMsg(e.message || "Couldn't reach the contract.");
            setStatus("error");
          }
        }
        return;
      }

      // Fallback: no contract configured yet, read the local mock record
      // instead so the flow is still demoable end-to-end.
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
        setStatus("not-found");
      }
    }

    check();
    return () => { cancelled = true; };
  }, [hash]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">ChainTDS — Verification</div>
      </header>
      <main className="app-main">
        <section className="card">
          {status === "checking" && <p className="muted">Checking record...</p>}

          {status === "verified" && record && (
            <>
              <h1>✓ Verified</h1>
              <p className="muted">
                {isChainConfigured
                  ? "This hash is anchored on the Polygon Amoy smart contract."
                  : "This report's fingerprint matches a record on this device. No contract is configured yet — this is the local fallback, not a real on-chain check."}
              </p>
              <div className="kv"><span>SHA-256</span><code>{record.reportHash}</code></div>
              {record.network && <div className="kv"><span>Network</span><code>{record.network}</code></div>}
              {record.txHash && <div className="kv"><span>Tx hash</span><code>{record.txHash}</code></div>}
              {record.submitter && <div className="kv"><span>Submitted by</span><code>{record.submitter}</code></div>}
              {record.blockNumber && <div className="kv"><span>Block</span><code>{record.blockNumber}</code></div>}
              {record.timestamp && <div className="kv"><span>Anchored at</span><code>{record.timestamp}</code></div>}
            </>
          )}

          {status === "not-found" && (
            <>
              <h1>No record found</h1>
              <p className="muted">
                {isChainConfigured
                  ? "This hash hasn't been anchored on the contract."
                  : "No report matching this hash was found on this device. Once VITE_CONTRACT_ADDRESS is set, this page checks the real Polygon Amoy contract instead — verifiable from any device."}
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <h1>Couldn't verify</h1>
              <p className="muted">{errorMsg}</p>
            </>
          )}

          <button className="link-btn" onClick={() => { window.location.hash = ""; }}>
            Back to ChainTDS
          </button>
        </section>
      </main>
    </div>
  );
}
