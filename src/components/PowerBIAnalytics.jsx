import { useMemo, useState } from "react";
import { computeAllTdsRows } from "../utils/tdsDiscrepancy";

const TYPE_LABELS = {
  TDS_MISMATCH: "TDS mismatch",
  TDS_GAP: "TDS gap",
  ORPHANED_WITHDRAWAL: "Orphaned withdrawal",
  UNKNOWN_SOURCE: "Unknown source",
};

function money(n) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

function groupBy(rows, key) {
  const map = {};
  rows.forEach((r) => {
    const k = r[key] || "Unknown";
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

export default function PowerBIAnalytics({ allRows = [], discrepancies = [], reconciliation = null, cases = [], role = "taxpayer" }) {
  const [selected, setSelected] = useState(null);

  const data = useMemo(() => {
    if (role === "taxpayer") return buildTaxpayerData(allRows, discrepancies, reconciliation);
    return buildCaseData(cases);
  }, [allRows, discrepancies, reconciliation, cases, role]);

  const selectedDiscrepancy = selected ? discrepancies[selected] : null;

  return (
    <section className="pbi-shell">
      <div className="pbi-heading">
        <div>
          <div className="eyebrow">T-REX ANALYTICS</div>
          <h2>Compliance intelligence</h2>
          <p>Interactive Power BI-style analytics built from the existing T-REX compliance data.</p>
        </div>
        <div className="pbi-filter">LIVE DATA · {role === "taxpayer" ? "YOUR REPORT" : role.toUpperCase()}</div>
      </div>

      <div className="pbi-kpis">
        {data.kpis.map((k) => (
          <div className="pbi-kpi" key={k.label}>
            <span>{k.label}</span>
            <strong>{k.value}</strong>
            {k.sub && <small>{k.sub}</small>}
          </div>
        ))}
      </div>

      <div className="pbi-grid">
        <ChartCard title="TDS expected vs deducted" subtitle="Exchange-level comparison">
          <BarChart data={data.exchangeTds} dual />
        </ChartCard>
        <ChartCard title="Discrepancies by type" subtitle="Click a category to inspect the underlying records">
          <DonutChart data={data.discrepancyTypes} onSelect={(label) => {
            const index = discrepancies.findIndex((d) => (TYPE_LABELS[d.type] || d.type) === label);
            if (index >= 0) setSelected(index);
          }} />
        </ChartCard>
        <ChartCard title="Transactions by exchange" subtitle="Volume of records processed">
          <BarChart data={data.exchangeTransactions} />
        </ChartCard>
        <ChartCard title="Risk distribution" subtitle="Current compliance risk profile">
          <DonutChart data={data.risk} />
        </ChartCard>
        <ChartCard title="TDS coverage by exchange" subtitle="Reported TDS as a share of expected TDS">
          <BarChart data={data.coverage} suffix="%" max={100} />
        </ChartCard>
        <ChartCard title="Activity trend" subtitle="Transactions grouped by report date">
          <LineChart data={data.trend} />
        </ChartCard>
      </div>

      <div className="pbi-discrepancies">
        <div className="pbi-section-head">
          <div>
            <div className="eyebrow">INVESTIGATION QUEUE</div>
            <h3>Discrepancies</h3>
          </div>
          <span>{discrepancies.length} flagged record{discrepancies.length === 1 ? "" : "s"}</span>
        </div>
        {discrepancies.length === 0 ? (
          <div className="pbi-empty">No TDS discrepancies detected in the current data.</div>
        ) : (
          <div className="pbi-discrepancy-table-wrap">
            <table className="data-table pbi-table">
              <thead><tr><th>Transaction</th><th>Type</th><th>Exchange</th><th>Expected</th><th>Reported</th><th>Gap</th><th>Risk</th><th /></tr></thead>
              <tbody>
                {discrepancies.map((d, i) => (
                  <tr key={`${d.transactionId}-${i}`} className={selected === i ? "pbi-selected-row" : ""}>
                    <td><strong>{d.transactionId}</strong><div className="muted small">{d.date} · {d.asset}</div></td>
                    <td>{TYPE_LABELS[d.type] || d.type}</td>
                    <td>{d.exchange}</td>
                    <td>{money(d.expectedTds)}</td>
                    <td>{money(d.reportedTds)}</td>
                    <td><strong>{money(Math.abs(d.difference))}</strong></td>
                    <td><span className={`risk-pill risk-pill-${d.riskTier}`}>{d.riskTier}</span></td>
                    <td><button className="pbi-investigate-btn" onClick={() => setSelected(i)}>Investigate</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDiscrepancy && (
        <div className="pbi-investigation">
          <div>
            <div className="eyebrow">SELECTED DISCREPANCY</div>
            <h3>{TYPE_LABELS[selectedDiscrepancy.type] || selectedDiscrepancy.type}</h3>
            <p className="muted">{selectedDiscrepancy.transactionId} · {selectedDiscrepancy.exchange} · {selectedDiscrepancy.date}</p>
          </div>
          <div className="pbi-investigation-stats">
            <span>Expected <strong>{money(selectedDiscrepancy.expectedTds)}</strong></span>
            <span>Reported <strong>{money(selectedDiscrepancy.reportedTds)}</strong></span>
            <span>Gap <strong>{money(Math.abs(selectedDiscrepancy.difference))}</strong></span>
          </div>
          <div className="pbi-investigation-actions">
            <button className="primary-btn" onClick={() => document.getElementById(`trex-discrepancy-${selectedDiscrepancy.transactionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>INVESTIGATE</button>
            <button className="secondary-btn" onClick={() => document.getElementById(`trex-discrepancy-${selectedDiscrepancy.transactionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>EXPLAIN WITH AI</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ChartCard({ title, subtitle, children }) {
  return <div className="pbi-chart-card"><div className="pbi-chart-title"><h3>{title}</h3><span>{subtitle}</span></div>{children}</div>;
}

function BarChart({ data, dual = false, suffix = "", max }) {
  const maxValue = max || Math.max(1, ...data.flatMap((d) => dual ? [d.expected, d.reported] : [d.value]));
  return <div className="pbi-bars">
    {data.length === 0 && <div className="pbi-empty">No data available.</div>}
    {data.slice(0, 8).map((d) => <div className="pbi-bar-row" key={d.label}>
      <div className="pbi-bar-label" title={d.label}>{d.label}</div>
      <div className="pbi-bar-track">
        {dual ? <><span className="pbi-bar expected" style={{ width: `${Math.max(2, (d.expected / maxValue) * 100)}%` }} /><span className="pbi-bar reported" style={{ width: `${Math.max(2, (d.reported / maxValue) * 100)}%` }} /></> : <span className="pbi-bar" style={{ width: `${Math.max(2, (d.value / maxValue) * 100)}%` }} />}
      </div>
      <strong>{dual ? `${money(d.expected)} / ${money(d.reported)}` : `${d.value}${suffix}`}</strong>
    </div>)}
    {dual && <div className="pbi-legend"><span><i className="legend-expected" /> Expected</span><span><i className="legend-reported" /> Reported</span></div>}
  </div>;
}

function DonutChart({ data, onSelect }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let cursor = 0;
  const segments = data.map((d) => { const start = total ? (cursor / total) * 360 : 0; cursor += d.value; return `${d.label} ${start}deg ${(cursor / Math.max(1, total)) * 360}deg`; });
  const gradient = data.length ? `conic-gradient(${segments.map((s, i) => `${i % 2 ? "#000000" : "#7C9774"} ${s.split(" ").slice(1).join(" ")}`).join(", ")})` : "#e9ece8";
  return <div className="pbi-donut-layout">
    <div className="pbi-donut" style={{ background: gradient }}><div><strong>{total}</strong><span>Total</span></div></div>
    <div className="pbi-donut-legend">{data.map((d, i) => <button key={d.label} onClick={() => onSelect?.(d.label)}><i style={{ background: i % 2 ? "#000000" : "#7C9774" }} /> <span>{d.label}</span><strong>{d.value}</strong></button>)}</div>
  </div>;
}

function LineChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const points = data.map((d, i) => `${data.length === 1 ? 50 : (i / (data.length - 1)) * 100},${88 - (d.value / max) * 72}`).join(" ");
  return <div className="pbi-line-wrap"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pbi-line-svg"><polyline points={points} fill="none" stroke="#7C9774" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg><div className="pbi-line-labels">{data.map((d) => <span key={d.label}>{d.label}</span>)}</div></div>;
}

function buildTaxpayerData(allRows, discrepancies, reconciliation) {
  const tds = computeAllTdsRows(allRows);
  const exchanges = Array.from(new Set(allRows.map((r) => r.exchange).filter(Boolean)));
  const exchangeTds = exchanges.map((exchange) => { const rows = tds.filter((r) => r.exchange === exchange); return { label: exchange, expected: rows.reduce((s, r) => s + r.expectedTds, 0), reported: rows.reduce((s, r) => s + r.reportedTds, 0) }; });
  const exchangeTransactions = exchanges.map((exchange) => ({ label: exchange, value: allRows.filter((r) => r.exchange === exchange).length }));
  const coverage = exchangeTds.map((d) => ({ label: d.label, value: d.expected ? Math.round((d.reported / d.expected) * 100) : 100 }));
  const risk = groupBy(tds.filter((r) => r.hasDiscrepancy), "riskTier").map((x) => ({ ...x, label: `${x.label[0].toUpperCase()}${x.label.slice(1)} risk` }));
  const discrepancyTypes = groupBy(discrepancies.map((d) => ({ type: TYPE_LABELS[d.type] || d.type })), "type");
  const dates = groupBy(allRows.map((r) => ({ date: r.date || "Unknown" })), "date").sort((a, b) => String(a.label).localeCompare(String(b.label))).slice(-8);
  const totalExpected = tds.reduce((s, r) => s + r.expectedTds, 0);
  const totalReported = tds.reduce((s, r) => s + r.reportedTds, 0);
  return {
    kpis: [
      { label: "Transactions", value: allRows.length },
      { label: "Trading volume", value: money(allRows.reduce((s, r) => s + (Number(r.inrValue) || 0), 0)) },
      { label: "TDS expected", value: money(totalExpected) },
      { label: "TDS deducted", value: money(totalReported) },
      { label: "TDS gap", value: money(Math.max(0, totalExpected - totalReported)) },
      { label: "Discrepancies", value: discrepancies.length },
    ], exchangeTds, exchangeTransactions, coverage, risk, discrepancyTypes, trend: dates,
  };
}

function buildCaseData(cases) {
  const rows = cases.flatMap((c) => c.allRows || []);
  const discrepancies = cases.flatMap((c) => c.discrepancies || []);
  const base = buildTaxpayerData(rows, discrepancies, null);
  const caseStatuses = groupBy(cases, "status");
  const highRisk = cases.filter((c) => (c.discrepancies || []).some((d) => d.riskTier === "high")).length;
  return { ...base, kpis: [
    { label: "Taxpayers", value: new Set(cases.map((c) => c.taxpayerId)).size },
    { label: "Reports", value: cases.length },
    { label: "Transactions", value: rows.length },
    { label: "TDS expected", value: base.kpis[2].value },
    { label: "TDS deducted", value: base.kpis[3].value },
    { label: "High-risk cases", value: highRisk },
  ], risk: caseStatuses.map((x) => ({ label: x.label, value: x.value })) };
}
