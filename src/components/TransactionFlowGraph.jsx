import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Renders the movement of funds as a node/edge graph, one edge per real
// transaction row (not aggregated by exchange pair):
//   - exchanges + individual wallets as nodes
//   - clean cross-platform transfers -> green edges to the destination
//   - transfers with a TDS gap, orphaned withdrawals, unknown-source
//     deposits -> red edges (warnings)
//   - SELL trades with a TDS discrepancy -> orange edges into "INR / Bank"
//   - SELL trades with no discrepancy -> green edges into "INR / Bank"
//
// Terminal/virtual nodes (INR / Bank, Unknown source, Unknown / off-ramp)
// are pinned to a fixed column on the right so they read as clear
// endpoints instead of just more nodes competing for space in the row.
//
// Every edge is drawn from data reconcile.js / tdsDiscrepancy.js already
// computed — this component lays it out, it never re-derives compliance.
// ---------------------------------------------------------------------------

const WIDTH = 880;
const HEIGHT = 300;
const NODE_R = 8;
const TOP_Y = 60;
const BOTTOM_Y = 230;
const TERMINAL_X = WIDTH - 70;
const TERMINAL_COLUMN_Y = [55, 150, 245];

export default function TransactionFlowGraph({ allRows, reconciliation, discrepancies, walletAnalyses = {} }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const { nodes, edges } = useMemo(
    () => {
      if (allRows.length === 0) return buildWalletGraph(walletAnalyses);
      return buildGraph(allRows, reconciliation, discrepancies);
    },
    [allRows, reconciliation, discrepancies, walletAnalyses]
  );

  if (nodes.length === 0) {
    return <p className="muted small">No transaction flow to display yet.</p>;
  }

  return (
    <div className="flow-graph-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="flow-graph-svg">
        <defs>
          <marker id="flow-arrow-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
          <marker id="flow-arrow-gap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--danger)" />
          </marker>
          <marker id="flow-arrow-unknown" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#e2543a" />
          </marker>
          <marker id="flow-arrow-discrepancy" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#d9822b" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const active = hoverIdx === i;
          const path = curvePath(e.x1, e.y1, e.x2, e.y2, e.curveOffset || 0);
          const markerId = `flow-arrow-${e.kind === "gap" || e.kind === "unknown" ? e.kind : e.kind === "discrepancy" ? "discrepancy" : "ok"}`;
          const strokeClass = `flow-edge-${e.kind === "ok" ? "ok" : e.kind}`;

          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              <path
                d={path}
                className={`flow-edge ${strokeClass} ${active ? "flow-edge-active" : ""}`}
                markerEnd={`url(#${markerId})`}
                strokeDasharray={e.dashed ? "5 4" : undefined}
              />
              <text
                x={(e.x1 + e.x2) / 2}
                y={(e.y1 + e.y2) / 2 - 8 - (e.curveOffset || 0)}
                textAnchor="middle"
                className={`flow-edge-label ${active ? "flow-edge-label-active" : ""}`}
              >
                {e.label}
              </text>
            </g>
          );
        })}

        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={NODE_R} className={`flow-node ${n.virtual ? "flow-node-virtual" : ""}`} />
            <text
              x={n.x}
              y={n.y > HEIGHT / 2 ? n.y + 22 : n.y - 16}
              textAnchor={n.virtual ? "end" : "middle"}
              className="flow-node-label"
            >
              {n.name}
            </text>
          </g>
        ))}
      </svg>

      <div className="flow-legend">
        <span><i className="flow-dot flow-dot-ok" /> Reconciled / clean</span>
        <span><i className="flow-dot flow-dot-gap" /> TDS gap on transfer</span>
        <span><i className="flow-dot flow-dot-discrepancy" /> Compliance discrepancy on sale</span>
        <span><i className="flow-dot flow-dot-unknown" /> Unmatched / unknown source</span>
      </div>
    </div>
  );
}

function buildWalletGraph(walletAnalyses) {
  const analyses = Object.values(walletAnalyses).filter(Boolean);
  const nodes = [];
  const edges = [];
  analyses.forEach((analysis, walletIndex) => {
    const wallet = analysis.wallet;
    const rootName = `${String(wallet).slice(0, 6)}…${String(wallet).slice(-4)}`;
    nodes.push({ name: rootName, x: 110, y: 60 + Math.min(walletIndex, 2) * 100, virtual: false });
    const root = { name: rootName, x: 110, y: 60 + Math.min(walletIndex, 2) * 100 };
    (analysis.provenance?.edges || []).slice(0, 20).forEach((edge, i) => {
      const incoming = edge.direction === "IN";
      const counterparty = incoming ? edge.from : edge.to;
      const label = `${edge.amount} ${edge.asset}`;
      edges.push({
        x1: incoming ? 430 : root.x + 15,
        y1: root.y + (i % 5) * 18,
        x2: incoming ? root.x - 15 : 430,
        y2: root.y + (i % 5) * 18,
        label,
        kind: "ok",
        dashed: true,
      });
      if (i < 5) nodes.push({
        name: `${String(counterparty).slice(0, 6)}…${String(counterparty).slice(-4)}`,
        x: incoming ? 430 : 430,
        y: root.y + (i % 5) * 18,
        virtual: false,
      });
    });
  });
  return { nodes, edges };
}

function buildGraph(allRows, reconciliation, discrepancies = []) {
  if (!allRows || !reconciliation) return { nodes: [], edges: [] };

  const exchangeNames = Array.from(new Set(allRows.map((r) => r.exchange))).filter(Boolean);

  const hasOrphanedWithdrawal = reconciliation.warnings.some((w) => w.type === "ORPHANED_WITHDRAWAL");
  const hasUnknownSource = reconciliation.unmatchedDeposits.length > 0;
  const hasSells = allRows.some((r) => r.type === "SELL");

  // Terminal/virtual nodes get a fixed slot in the right-hand column so
  // they read as endpoints rather than competing for space with exchanges.
  const terminalNames = [
    hasOrphanedWithdrawal ? "Unknown / off-ramp" : null,
    hasUnknownSource ? "Unknown source" : null,
    hasSells ? "INR / Bank" : null,
  ].filter(Boolean);

  const positions = {};

  const spacing = WIDTH * 0.78 / (exchangeNames.length + 1);
  exchangeNames.forEach((name, i) => {
    const x = spacing * (i + 1);
    const y = i % 2 === 0 ? TOP_Y : BOTTOM_Y;
    positions[name] = { x, y, virtual: false };
  });

  terminalNames.forEach((name, i) => {
    positions[name] = { x: TERMINAL_X, y: TERMINAL_COLUMN_Y[i], virtual: true };
  });

  const allNames = [...exchangeNames, ...terminalNames];
  const nodes = allNames.map((name) => ({ name, ...positions[name] }));

  const edges = [];
  const pairEdgeCount = {}; // fan out multiple edges between the same two nodes

  function pushEdge(fromName, toName, label, kind, dashed) {
    const from = positions[fromName];
    const to = positions[toName];
    if (!from || !to) return;
    const pairKey = `${fromName}->${toName}`;
    const count = pairEdgeCount[pairKey] || 0;
    pairEdgeCount[pairKey] = count + 1;
    edges.push({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      label,
      kind,
      dashed,
      curveOffset: count * 10,
    });
  }

  // Cross-platform transfers (withdrawal -> matched deposit elsewhere).
  for (const tc of reconciliation.transferChecks) {
    pushEdge(
      tc.from,
      tc.to,
      `${tc.amount} ${tc.asset}`,
      tc.status === "TDS_GAP" ? "gap" : "ok",
      tc.confidence < 60
    );
  }

  // Orphaned withdrawals: money left an exchange with no matching deposit found.
  const orphanRefIds = new Set(
    reconciliation.warnings.filter((w) => w.type === "ORPHANED_WITHDRAWAL").map((w) => w.refId)
  );
  for (const r of allRows) {
    if (r.type === "WITHDRAWAL" && orphanRefIds.has(r.refId)) {
      pushEdge(r.exchange, "Unknown / off-ramp", `${r.amount} ${r.asset}`, "unknown", true);
    }
  }

  // Unmatched deposits: money arrived with no matching withdrawal found.
  const depositRefIds = new Set(reconciliation.unmatchedDeposits.map((d) => d.refId));
  for (const r of allRows) {
    if (r.type === "DEPOSIT" && depositRefIds.has(r.refId)) {
      pushEdge("Unknown source", r.exchange, `${r.amount} ${r.asset}`, "unknown", true);
    }
  }

  // Every SELL cashes out to INR/Bank — green if clean, orange if it has a
  // matching TDS discrepancy.
  const discrepancyByRef = new Map((discrepancies || []).map((d) => [d.transactionId, d]));
  for (const r of allRows) {
    if (r.type !== "SELL") continue;
    const disc = discrepancyByRef.get(r.refId);
const hasTdsDiscrepancy = disc?.hasTdsDiscrepancy === true;
const hasValuationMismatch = disc?.hasValuationDiscrepancy === true;

pushEdge(
  r.exchange,
  "INR / Bank",
  `${r.amount} ${r.asset}`,
  hasTdsDiscrepancy || hasValuationMismatch ? "discrepancy" : "ok",
  false
);
  }

  return { nodes, edges };
}

function curvePath(x1, y1, x2, y2, extraOffset = 0) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.08 - extraOffset;
  return `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
}
