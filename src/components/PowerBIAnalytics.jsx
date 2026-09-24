import { useMemo, useState, useEffect } from "react";
import { computeAllTdsRows } from "../utils/tdsDiscrepancy";
import { explainDiscrepancy, investigateTransaction } from "../services/complianceAssistant";
import { buildDiscrepancyEvidence, buildTransactionEvidence } from "../utils/evidenceBuilder";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart as RechartsLineChart,
  Line
} from "recharts";

const TYPE_LABELS = {
  TDS_MISMATCH: "TDS mismatch",
  TDS_GAP: "TDS gap",
  ORPHANED_WITHDRAWAL: "Orphaned withdrawal",
  UNKNOWN_SOURCE: "Unknown source",
  DEX_SWAP: "DEX swap",
  PENDING_MANUAL_REVIEW: "Pending manual review",
  VALUATION_ESTIMATED: "Estimated INR valuation",
  VALUATION_UNRESOLVED: "Unresolved valuation",
  VALUATION_MISMATCH: "Valuation mismatch",
};

function money(n) {
  const value = Number(n);
  return Number.isFinite(value)
    ? `₹${Math.round(value).toLocaleString("en-IN")}`
    : "Unavailable";
}

function groupBy(rows, key) {
  const map = {};
  rows.forEach((r) => {
    const k = r[key] || "Unknown";
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

export default function PowerBIAnalytics({ allRows = [], discrepancies = [], reconciliation = null, walletAnalyses = {}, cases = [], role = "taxpayer" }) {
  const [selected, setSelected] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [loadingExplanation, setLoadingExplanation] = useState(false);

  useEffect(() => {
    setExplanation(null);
  }, [selected]);

  const data = useMemo(() => {
    if (role === "taxpayer") return buildTaxpayerData(allRows, discrepancies, reconciliation, walletAnalyses);
    return buildCaseData(cases);
  }, [allRows, discrepancies, reconciliation, walletAnalyses, cases, role]);

  const investigationQueue = data.investigationQueue || discrepancies;
  const selectedDiscrepancy = selected != null ? investigationQueue[selected] : null;

  async function handleExplain() {
    if (!selectedDiscrepancy) return;
    setLoadingExplanation(true);
    try {
      const isOriginalDiscrepancy = selected < discrepancies.length;
      let evidence;
      let r;

      if (isOriginalDiscrepancy) {
        evidence = buildDiscrepancyEvidence(selectedDiscrepancy, { reconciliation, allRows });
        r = await explainDiscrepancy(evidence);
      } else {
        const flag = { type: selectedDiscrepancy.type, refId: selectedDiscrepancy.transactionId };
        evidence = buildTransactionEvidence(flag, { reconciliation, allRows, walletAnalyses });
        r = await investigateTransaction(evidence);
        // Normalize response to match explainDiscrepancy
        if (r.investigation) {
          r.explanation = r.investigation;
        }
      }
      setExplanation(r);
    } finally {
      setLoadingExplanation(false);
    }
  }

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
            const index = investigationQueue.findIndex((d) => (TYPE_LABELS[d.type] || d.type) === label);
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
          <span>{investigationQueue.length} flagged record{investigationQueue.length === 1 ? "" : "s"}</span>
        </div>
        {investigationQueue.length === 0 ? (
          <div className="pbi-empty">No unresolved reconciliation items in the current data.</div>
        ) : (
          <div className="pbi-discrepancy-table-wrap">
            <table className="data-table pbi-table">
              <thead><tr><th>Transaction</th><th>Type</th><th>Exchange</th><th>Expected</th><th>Reported</th><th>Gap</th><th>Risk</th><th /></tr></thead>
              <tbody>
                {investigationQueue.map((d, i) => (
                  <tr key={`${d.transactionId}-${i}`} className={selected === i ? "pbi-selected-row" : ""}>
                    <td><strong>{d.transactionId}</strong><div className="muted small">{d.date} · {d.asset}</div></td>
                    <td>{TYPE_LABELS[d.type] || d.type}</td>
                    <td>{d.exchange}</td>
                    <td>{money(d.expectedTds)}</td>
                    <td>{money(d.reportedTds)}</td>
                    <td><strong>{money(d.difference == null ? null : Math.abs(d.difference))}</strong></td>
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
            <span>Gap <strong>{money(selectedDiscrepancy.difference == null ? null : Math.abs(selectedDiscrepancy.difference))}</strong></span>
          </div>
          <div className="pbi-investigation-actions" style={{ display: 'flex', gap: '12px' }}>
            {!explanation && !loadingExplanation && (
              <button className="primary-btn" onClick={handleExplain} style={{ width: '220px', padding: '8px 16px' }}>
                INVESTIGATE WITH AI
              </button>
            )}
          </div>
          {loadingExplanation && (
            <div style={{ gridColumn: '1 / -1', marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', backgroundColor: 'rgba(124, 151, 116, 0.1)', borderRadius: '8px' }}>
              <style>{`
                @keyframes pbi-run {
                  0% { transform: translateX(-10px) scaleX(1); }
                  49% { transform: translateX(10px) scaleX(1); }
                  50% { transform: translateX(10px) scaleX(-1); }
                  99% { transform: translateX(-10px) scaleX(-1); }
                  100% { transform: translateX(-10px) scaleX(1); }
                }
              `}</style>
              <div style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
                <span style={{ fontSize: '28px', animation: 'pbi-run 1.5s linear infinite', display: 'inline-block' }}>🦖</span>
              </div>
              <span className="muted" style={{ fontWeight: 500 }}>T-REX is analyzing the data...</span>
            </div>
          )}
          {explanation && (
            <div className="ai-explanation" style={{ gridColumn: '1 / -1', marginTop: '16px', padding: '16px', backgroundColor: 'rgba(124, 151, 116, 0.15)', borderRadius: '8px', border: '1px solid rgba(124, 151, 116, 0.4)', color: '#eaeaea' }}>
              <div className="ai-explanation-text" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '14px' }}>{explanation.explanation}</div>
              <details className="audit-trail" style={{ marginTop: '12px', fontSize: '13px' }}>
                <summary>Evidence used</summary>
                <ul>
                  {explanation.evidenceUsed.map((e, i) => (
                    <li key={i}>✓ {e}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ChartCard({ title, subtitle, children }) {
  return <div className="pbi-chart-card"><div className="pbi-chart-title"><h3>{title}</h3><span>{subtitle}</span></div>{children}</div>;
}

function BarChart({ data, dual = false, suffix = "", max }) {
  if (data.length === 0) return <div className="pbi-empty">No data available.</div>;
  
  return (
    <div style={{ width: '100%', height: 250 }}>
      <ResponsiveContainer>
        <RechartsBarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis dataKey="label" stroke="#888" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis stroke="#888" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(val) => suffix ? `${val}${suffix}` : val} />
          <Tooltip 
            cursor={{ fill: '#222' }}
            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px' }}
            formatter={(value, name) => {
              if (dual) return [money(value), name === 'expected' ? 'Expected' : 'Reported'];
              return [suffix ? `${value}${suffix}` : value, 'Value'];
            }}
          />
          {dual && <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />}
          {dual ? (
            <>
              <Bar dataKey="expected" fill="#7C9774" maxBarSize={60} radius={[2, 2, 0, 0]} name="Expected" />
              <Bar dataKey="reported" fill="#ffffff" maxBarSize={60} radius={[2, 2, 0, 0]} name="Reported" />
            </>
          ) : (
            <Bar dataKey="value" fill="#7C9774" maxBarSize={60} radius={[2, 2, 0, 0]} name="Value" />
          )}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

const COLORS = ["#7C9774", "#9bb991", "#4f6349", "#d4e0d1", "#2c3b28"];

function DonutChart({ data, onSelect }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0) return <div className="pbi-empty">No data available.</div>;

  return (
    <div style={{ width: '100%', height: 250, display: 'flex', alignItems: 'center', position: 'relative' }}>
      <div style={{ width: '60%', height: '100%', position: 'relative' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              innerRadius="60%"
              outerRadius="80%"
              paddingAngle={2}
              dataKey="value"
              onClick={(entry) => onSelect?.(entry.label)}
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} style={{ cursor: 'pointer', outline: 'none' }} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <strong style={{ fontSize: '24px', lineHeight: 1, color: '#fff' }}>{total}</strong>
          <span style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
        </div>
      </div>
      <div style={{ width: '40%', maxHeight: '200px', overflowY: 'auto' }} className="pbi-donut-legend">
        {data.map((d, i) => (
          <button key={d.label} onClick={() => onSelect?.(d.label)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '4px 0', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <i style={{ background: COLORS[i % COLORS.length], width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            </div>
            <strong style={{ fontSize: '12px', marginLeft: '8px' }}>{d.value}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data }) {
  if (data.length === 0) return <div className="pbi-empty">No data available.</div>;
  return (
    <div style={{ width: '100%', height: 250 }}>
      <ResponsiveContainer>
        <RechartsLineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis dataKey="label" stroke="#888" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis stroke="#888" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px' }}
          />
          <Line type="monotone" dataKey="value" stroke="#7C9774" strokeWidth={3} dot={{ fill: '#7C9774', r: 4 }} activeDot={{ r: 6 }} />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildTaxpayerData(
  allRows,
  discrepancies,
  reconciliation,
  walletAnalyses = {}
) {
  const tds = computeAllTdsRows(allRows);
  const walletList = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses).filter(Boolean);
  const walletPendingReviewCount = walletList.reduce(
    (sum, analysis) => sum + (Number(analysis?.traceability?.pendingReviewCount) || 0),
    0
  );
  const warningPendingCount = reconciliation?.warnings?.filter(
    (warning) =>
      warning.type === "VALUATION_UNRESOLVED" ||
      warning.type === "VALUATION_ESTIMATED" ||
      warning.type === "TDS_GAP" ||
      warning.type === "PENDING_MANUAL_REVIEW"
  ).length || 0;
  const pendingReviewCount = Math.max(warningPendingCount, walletPendingReviewCount);

  const walletTransferCount = walletList.reduce(
    (sum, analysis) => sum + (Number(analysis.transferCount) || 0),
    0
  );

  const walletOnly = allRows.length === 0 && walletTransferCount > 0;

  // ---------------------------------------------------------------
  // CENTRALIZED EXCHANGE ANALYTICS
  // ---------------------------------------------------------------

  const exchanges = Array.from(
    new Set(allRows.map((r) => r.exchange).filter(Boolean))
  );

  const exchangeTds = exchanges.map((exchange) => {
    const rows = tds.filter((r) => r.exchange === exchange);
    const hasUnknownExpectedTds = rows.some((r) => r.expectedTds == null);
    const hasUnreportedTds = rows.some((r) => r.reportedTds == null);

    return {
      label: exchange,
      expected: hasUnknownExpectedTds
        ? null
        : rows.reduce((sum, r) => sum + Number(r.expectedTds), 0),
      reported: hasUnreportedTds
        ? null
        : rows.reduce((sum, r) => sum + Number(r.reportedTds), 0),
      hasTdsRows: rows.length > 0,
      hasUnknownExpectedTds,
      hasUnreportedTds,
    };
  });

  const exchangeTransactions = exchanges.map((exchange) => ({
    label: exchange,
    value: allRows.filter((r) => r.exchange === exchange).length,
  }));

  const coverage = exchangeTds.map((d) => ({
    label: d.label,
    value: !d.hasTdsRows || d.expected == null || d.reported == null
      ? null
      : d.expected
      ? Math.round((d.reported / d.expected) * 100)
      : 100,
  }));

  const risk = groupBy(
    tds.filter((r) => r.hasDiscrepancy),
    "riskTier"
  ).map((x) => ({
    ...x,
    label: `${x.label[0].toUpperCase()}${x.label.slice(1)} risk`,
  }));

  const warningInvestigationItems = (reconciliation?.warnings || [])
    .filter((warning) =>
      [
        "PENDING_MANUAL_REVIEW",
        "VALUATION_ESTIMATED",
        "VALUATION_UNRESOLVED",
        "VALUATION_MISMATCH",
        "ORPHANED_WITHDRAWAL",
        "TDS_GAP",
      ].includes(warning.type)
    )
    .map((warning) => ({
      transactionId: warning.refId,
      type: warning.type,
      exchange: "On-chain / wallet",
      date: null,
      asset: null,
      expectedTds: null,
      reportedTds: null,
      difference: null,
      riskTier: warning.type === "PENDING_MANUAL_REVIEW" ? "medium" : "medium",
      message: warning.message,
    }));
  const unmatchedInvestigationItems = (reconciliation?.unmatchedDeposits || []).map((deposit) => ({
    transactionId: deposit.refId,
    type: deposit.type || "UNKNOWN_SOURCE",
    exchange: "On-chain / wallet",
    date: null,
    asset: null,
    expectedTds: null,
    reportedTds: null,
    difference: null,
    riskTier: "medium",
    message: deposit.message,
  }));
  const investigationQueue = [
    ...discrepancies,
    ...warningInvestigationItems,
    ...unmatchedInvestigationItems,
  ];

  const discrepancyTypes = groupBy(
    investigationQueue.map((d) => ({
      type: TYPE_LABELS[d.type] || d.type,
    })),
    "type"
  );

  const dates = groupBy(
    allRows.map((r) => ({
      date: r.date || "Unknown",
    }))
  )
    .sort((a, b) =>
      String(a.label).localeCompare(String(b.label))
    )
    .slice(-8);

  const hasUnknownExpectedTds = tds.some((r) => r.expectedTds == null);
  const totalExpected = hasUnknownExpectedTds
    ? null
    : tds.reduce((sum, r) => sum + Number(r.expectedTds), 0);

  const reportedTdsRows = tds.filter(
    (r) => r.reportedTds != null
  );
  const hasUnreportedTds = tds.some(
    (r) => r.expectedTds == null || r.reportedTds == null
  );
  const totalReported = hasUnreportedTds
    ? null
    : reportedTdsRows.reduce((sum, r) => sum + Number(r.reportedTds), 0);

  // ---------------------------------------------------------------
  // WALLET-ONLY ANALYTICS
  // ---------------------------------------------------------------

  if (walletOnly) {
    const walletExchangeTransactions = walletList.map((analysis) => ({
      label: `${analysis.chain?.name || "Ethereum"} wallet`,
      value: Number(analysis.transferCount) || 0,
    }));

    return {
      kpis: [
        {
          label: "Transactions",
          value: walletTransferCount.toLocaleString("en-IN"),
          sub: "Observable on-chain transfers",
        },
        {
          label: "Trading volume",
          value: "—",
          sub: "No INR trade data",
        },
        {
          label: "TDS expected",
          value: "—",
          sub: "Not determined from wallet movements",
        },
        {
          label: "TDS deducted",
          value: "—",
          sub: "No exchange TDS record",
        },
        {
          label: "TDS gap",
          value: "—",
          sub: "Not applicable to wallet movements alone",
        },
        {
          label: "Discrepancies",
          value: investigationQueue.length,
          sub:
            investigationQueue.length === 0
              ? "No taxable trade discrepancies"
              : "Requires review",
        },
        {
          label: "Pending review",
          value: pendingReviewCount,
        },
      ],

      // Wallet activity replaces exchange TDS comparison.
      exchangeTds: [],

      // Number of observable transfers per wallet.
      exchangeTransactions: walletExchangeTransactions,

      // No TDS coverage can be calculated from wallet movements alone.
      coverage: [],

      // Use on-chain risk enrichment instead of TDS discrepancy risk.
      risk: buildWalletRiskData(walletList),

      discrepancyTypes,
      investigationQueue,

      // Wallet transfers do not represent taxable trade dates.
      trend: [],
    };
  }

  // ---------------------------------------------------------------
  // CENTRALIZED / MIXED ANALYTICS
  // ---------------------------------------------------------------

  return {
    kpis: [
      {
        label: "Transactions",
        value: allRows.length,
      },
      {
        label: "Trading volume",
        value: allRows.some(
          (r) => r.inrValue == null || !Number.isFinite(Number(r.inrValue))
        )
          ? "Unavailable"
          : money(allRows.reduce((sum, r) => sum + Number(r.inrValue), 0)),
      },
      {
        label: "TDS expected",
        value: money(totalExpected),
      },
      {
        label: "TDS deducted",
        value: hasUnreportedTds ? "Unavailable" : money(totalReported),
        sub: hasUnreportedTds
          ? "Pending valuation or reported TDS verification"
          : undefined,
      },
      {
        label: "TDS gap",
        value: hasUnreportedTds
          ? "Unavailable"
          : money(Math.max(0, totalExpected - totalReported)),
        sub: hasUnreportedTds
          ? "Cannot reconcile until TDS evidence is available"
          : undefined,
      },
      {
        label: "Discrepancies",
        value: investigationQueue.length,
      },
      {
        label: "Pending review",
        value: pendingReviewCount,
      },
    ],

    exchangeTds,

    exchangeTransactions,

    coverage,

    risk,

    discrepancyTypes,
    investigationQueue,

    trend: dates,
  };
}

function buildWalletRiskData(walletList) {
  const buckets = {
    low: 0,
    medium: 0,
    high: 0,
    unknown: 0,
  };
  walletList.forEach((analysis) => {
    const nodes = analysis.provenance?.nodes || [];
    nodes.forEach((node) => {
      const score = Number(node.riskScore);
      if (!Number.isFinite(score)) buckets.unknown += 1;
      else if (score >= 70) buckets.high += 1;
      else if (score >= 30) buckets.medium += 1;
      else buckets.low += 1;
    });
  });
  return Object.entries(buckets)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label: `${label[0].toUpperCase()}${label.slice(1)} risk`, value }));
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
