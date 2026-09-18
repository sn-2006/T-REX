import { useMemo, useState } from "react";
import { loadCases } from "../data/caseStore";
import { computeAllTdsRows } from "../utils/tdsDiscrepancy";
import DashboardHeader from "../components/DashboardHeader";
import CaseDetail from "../components/CaseDetail";

export default function RegulatorDashboard({ session, onLogout }) {
  const [cases] = useState(() => loadCases());
  const [selectedId, setSelectedId] = useState(null);

  const selected = cases.find((c) => c.id === selectedId) || null;
  const stats = useMemo(() => computeAnalytics(cases), [cases]);

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Government regulator dashboard" onLogout={onLogout} />

      <main className="app-main">
        {selected ? (
          <section className="card">
            <button className="link-btn" onClick={() => setSelectedId(null)}>
              ← Back to overview
            </button>
            <CaseDetail case_={selected} readOnly />
          </section>
        ) : (
          <>
            <section className="card">
              <h1>National compliance overview</h1>
              <p className="muted">
                Read-only, aggregated across every taxpayer report ChainTDS has processed.
              </p>

              <div className="ai-stats-grid regulator-stats-grid">
                <Stat label="Taxpayers" value={stats.totalTaxpayers} />
                <Stat label="Reports" value={stats.totalReports} />
                <Stat label="Transactions" value={stats.totalTransactions} />
                <Stat label="Expected TDS" value={`₹${stats.totalExpectedTds.toLocaleString("en-IN")}`} />
                <Stat label="Reported TDS" value={`₹${stats.totalReportedTds.toLocaleString("en-IN")}`} />
                <Stat
                  label="TDS coverage"
                  value={`${stats.tdsCoveragePct}%`}
                  risk={stats.tdsCoveragePct < 80}
                />
                <Stat label="High-risk cases" value={stats.highRiskCount} risk={stats.highRiskCount > 0} />
                <Stat label="Unmatched transfers" value={stats.unmatchedCount} risk={stats.unmatchedCount > 0} />
              </div>
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Exchange-wise analytics</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Exchange</th>
                    <th>Taxpayers</th>
                    <th>Trades</th>
                    <th>INR volume</th>
                    <th>Expected TDS</th>
                    <th>Reported TDS</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.exchangeRows.map((r) => (
                    <tr key={r.exchange} className={r.coverage < 70 ? "row-flag" : ""}>
                      <td>{r.exchange}</td>
                      <td>{r.taxpayers}</td>
                      <td>{r.trades}</td>
                      <td>₹{r.inrVolume.toLocaleString("en-IN")}</td>
                      <td>₹{r.expectedTds.toLocaleString("en-IN")}</td>
                      <td>₹{r.reportedTds.toLocaleString("en-IN")}</td>
                      <td>{r.coverage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>High-risk cases</h3>
              {stats.highRiskCases.length === 0 && (
                <p className="muted">No high-risk cases currently flagged.</p>
              )}
              <div className="case-list">
                {stats.highRiskCases.map((c) => (
                  <button key={c.id} className="case-row" onClick={() => setSelectedId(c.id)}>
                    <div>
                      <strong>{c.taxpayerName}</strong>
                      <span className="muted small"> · PAN {c.panMasked}</span>
                      <div className="muted small">{c.exchanges.join(", ")}</div>
                    </div>
                    <div className="case-row-right">
                      <span className="muted small">
                        {c.discrepancies.filter((d) => d.riskTier === "high").length} high-risk item(s)
                      </span>
                      <span className={`case-status-pill case-status-${c.status}`}>{c.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Unmatched transfers / unknown sources</h3>
              {stats.unmatchedRows.length === 0 && (
                <p className="muted">No unmatched transfers across any taxpayer.</p>
              )}
              <ul className="warning-list">
                {stats.unmatchedRows.map((w, i) => (
                  <li key={i}>
                    <strong>{w.taxpayerName}</strong> — {w.message}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h3 style={{ marginTop: 0 }}>All reports</h3>
              <div className="case-list">
                {cases.map((c) => (
                  <button key={c.id} className="case-row" onClick={() => setSelectedId(c.id)}>
                    <div>
                      <strong>{c.taxpayerName}</strong>
                      <span className="muted small"> · PAN {c.panMasked}</span>
                      <div className="muted small">{c.exchanges.join(", ")}</div>
                    </div>
                    <div className="case-row-right">
                      <span className={`case-status-pill case-status-${c.status}`}>{c.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, risk }) {
  return (
    <div className={`ai-stat ${risk ? "ai-stat-risk" : ""}`}>
      <div className="ai-stat-value">{value}</div>
      <div className="ai-stat-label">{label}</div>
    </div>
  );
}

function computeAnalytics(cases) {
  const totalTaxpayers = new Set(cases.map((c) => c.taxpayerId)).size;
  const totalReports = cases.length;
  const totalTransactions = cases.reduce((sum, c) => sum + c.allRows.length, 0);

  let totalExpectedTds = 0;
  let totalReportedTds = 0;
  let highRiskCount = 0;
  let unmatchedCount = 0;

  const exchangeMap = {};
  const highRiskCases = [];
  const unmatchedRows = [];

  for (const c of cases) {
    const tdsRows = computeAllTdsRows(c.allRows);
    totalExpectedTds += tdsRows.reduce((s, r) => s + r.expectedTds, 0);
    totalReportedTds += tdsRows.reduce((s, r) => s + r.reportedTds, 0);

    for (const r of tdsRows) {
      if (!exchangeMap[r.exchange]) {
        exchangeMap[r.exchange] = {
          exchange: r.exchange,
          taxpayers: new Set(),
          trades: 0,
          inrVolume: 0,
          expectedTds: 0,
          reportedTds: 0,
        };
      }
      const e = exchangeMap[r.exchange];
      e.taxpayers.add(c.taxpayerId);
      e.trades += 1;
      e.inrVolume += r.inrValue;
      e.expectedTds += r.expectedTds;
      e.reportedTds += r.reportedTds;
    }

    const caseHighRisk = c.discrepancies.filter((d) => d.riskTier === "high").length;
    if (caseHighRisk > 0) {
      highRiskCount += 1;
      highRiskCases.push(c);
    }

    const orphaned = c.reconciliation.warnings.filter((w) => w.type === "ORPHANED_WITHDRAWAL");
    const unmatchedDeposits = c.reconciliation.unmatchedDeposits;
    unmatchedCount += orphaned.length + unmatchedDeposits.length;

    for (const w of [...orphaned, ...unmatchedDeposits]) {
      unmatchedRows.push({ taxpayerName: c.taxpayerName, message: w.message });
    }
  }

  const tdsCoveragePct =
    totalExpectedTds > 0
      ? Math.round(Math.max(0, Math.min(100, (totalReportedTds / totalExpectedTds) * 100)))
      : 100;

  const exchangeRows = Object.values(exchangeMap).map((e) => ({
    exchange: e.exchange,
    taxpayers: e.taxpayers.size,
    trades: e.trades,
    inrVolume: Math.round(e.inrVolume),
    expectedTds: Math.round(e.expectedTds),
    reportedTds: Math.round(e.reportedTds),
    coverage:
      e.expectedTds > 0
        ? Math.round(Math.max(0, Math.min(100, (e.reportedTds / e.expectedTds) * 100)))
        : 100,
  }));

  return {
    totalTaxpayers,
    totalReports,
    totalTransactions,
    totalExpectedTds: Math.round(totalExpectedTds),
    totalReportedTds: Math.round(totalReportedTds),
    tdsCoveragePct,
    highRiskCount,
    unmatchedCount,
    exchangeRows,
    highRiskCases,
    unmatchedRows,
  };
}
