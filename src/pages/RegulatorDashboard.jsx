import { useEffect, useMemo, useState } from "react";
import { loadCases } from "../data/caseStore";
import { computeAllTdsRows } from "../utils/tdsDiscrepancy";
import DashboardHeader from "../components/DashboardHeader";
import CaseDetail from "../components/CaseDetail";
import PowerBIAnalytics from "../components/PowerBIAnalytics";

const STATUS_LABEL = {
  pending: "pending review",
  "high-risk": "flagged as high risk",
  verified: "verified",
  flagged: "flagged for follow-up",
};

export default function RegulatorDashboard({ session, onLogout }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [regionFilter, setRegionFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCases()
      .then((data) => !cancelled && setCases(data))
      .catch((e) => !cancelled && setError(e.message || "Couldn't load cases."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = cases.find((c) => c.id === selectedId) || null;
  const stats = useMemo(() => computeAnalytics(cases), [cases]);
  const regions = useMemo(
    () => Array.from(new Set(cases.map((c) => c.taxpayerRegion).filter(Boolean))).sort(),
    [cases]
  );
  const regionFilteredCases = useMemo(
    () => (regionFilter === "all" ? cases : cases.filter((c) => c.taxpayerRegion === regionFilter)),
    [cases, regionFilter]
  );

  function handleStatusPillClick(e, c) {
    e.stopPropagation();
    window.alert(`${c.taxpayerName}'s case is ${STATUS_LABEL[c.status] || c.status}.`);
  }

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
              {error && <div className="error">{error}</div>}
              {loading && <p className="muted">Loading cases...</p>}
              <p className="muted">
                Read-only, aggregated across every taxpayer report T-REX has processed.
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

            <PowerBIAnalytics cases={regionFilteredCases} discrepancies={regionFilteredCases.flatMap((c) => c.discrepancies || [])} role="regulator" />

            <section className="card">
              <h3 style={{ marginTop: 0 }}>Region-wise compliance</h3>
              <p className="muted small">Taxpayers grouped by the region they registered under.</p>
              {stats.regionRows.length === 0 && (
                <p className="muted">No region data yet — taxpayers select a region at signup.</p>
              )}
              {stats.regionRows.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Region</th>
                      <th>Taxpayers</th>
                      <th>Reports</th>
                      <th>Expected TDS</th>
                      <th>Reported TDS</th>
                      <th>Coverage</th>
                      <th>High-risk cases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.regionRows.map((r) => (
                      <tr key={r.region} className={r.coverage < 70 ? "row-flag" : ""}>
                        <td>{r.region}</td>
                        <td>{r.taxpayers}</td>
                        <td>{r.reports}</td>
                        <td>₹{r.expectedTds.toLocaleString("en-IN")}</td>
                        <td>₹{r.reportedTds.toLocaleString("en-IN")}</td>
                        <td>{r.coverage}%</td>
                        <td>{r.highRiskCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
              <div className="regulator-reports-header">
                <h3 style={{ marginTop: 0 }}>All reports</h3>
                <label className="field-label region-filter">
                  Region
                  <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
                    <option value="all">All regions</option>
                    {regions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="case-list">
                {regionFilteredCases.length === 0 && (
                  <p className="muted">No reports for this region yet.</p>
                )}
                {regionFilteredCases.map((c) => (
                  <button key={c.id} className="case-row" onClick={() => setSelectedId(c.id)}>
                    <div>
                      <strong>{c.taxpayerName}</strong>
                      <span className="muted small"> · PAN {c.panMasked}</span>
                      {c.taxpayerRegion && <span className="muted small"> · {c.taxpayerRegion}</span>}
                      <div className="muted small">{c.exchanges.join(", ")}</div>
                    </div>
                    <div className="case-row-right">
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
  const regionMap = {};
  const highRiskCases = [];
  const unmatchedRows = [];

  for (const c of cases) {
    const tdsRows = computeAllTdsRows(c.allRows);
    totalExpectedTds += tdsRows.reduce((s, r) => s + r.expectedTds, 0);
    totalReportedTds += tdsRows.reduce((s, r) => s + r.reportedTds, 0);

    const region = c.taxpayerRegion || "Unspecified";
    if (!regionMap[region]) {
      regionMap[region] = {
        region,
        taxpayers: new Set(),
        reports: 0,
        expectedTds: 0,
        reportedTds: 0,
        highRiskCount: 0,
      };
    }
    const rg = regionMap[region];
    rg.taxpayers.add(c.taxpayerId);
    rg.reports += 1;
    rg.expectedTds += tdsRows.reduce((s, r) => s + r.expectedTds, 0);
    rg.reportedTds += tdsRows.reduce((s, r) => s + r.reportedTds, 0);

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
      rg.highRiskCount += 1;
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

  const regionRows = Object.values(regionMap)
    .map((r) => ({
      region: r.region,
      taxpayers: r.taxpayers.size,
      reports: r.reports,
      expectedTds: Math.round(r.expectedTds),
      reportedTds: Math.round(r.reportedTds),
      highRiskCount: r.highRiskCount,
      coverage:
        r.expectedTds > 0
          ? Math.round(Math.max(0, Math.min(100, (r.reportedTds / r.expectedTds) * 100)))
          : 100,
    }))
    .sort((a, b) => b.taxpayers - a.taxpayers);

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
    regionRows,
    highRiskCases,
    unmatchedRows,
  };
}
