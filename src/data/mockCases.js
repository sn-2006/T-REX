import { reconcile } from "../utils/reconcile.js";
import { computeTdsDiscrepancies } from "../utils/tdsDiscrepancy.js";
import { buildComplianceInsights } from "../utils/evidenceBuilder.js";
import { generateNarrativeReport } from "../utils/aiReport.js";
import { mockAnchorOnChain } from "../utils/hash.js";

// ---------------------------------------------------------------------------
// Seed data for the Auditor and Regulator dashboards.
//
// These run through the exact same rule engine (reconcile.js,
// tdsDiscrepancy.js, evidenceBuilder.js) real taxpayer-uploaded CSVs do —
// nothing here is hand-faked at the results level, only the raw transaction
// rows are synthetic, playing the same role a real exchange CSV would.
// ---------------------------------------------------------------------------

function row(exchange, date, type, asset, amount, inrValue, tdsStatus, refId, tdsAmount = null) {
  return { exchange, date, type, asset, amount, inrValue, tdsStatus, tdsAmount, refId };
}

const RAW_CASES = [
  {
    taxpayerId: "ABCDE1234F",
    taxpayerName: "Rohit Sharma",
    exchanges: ["Binance", "WazirX"],
    wallets: [],
    rows: [
      row("Binance", "2026-05-01", "SELL", "BTC", 0.05, 285000, "DEDUCTED", "DEMO-RS-1"),
      row("Binance", "2026-05-03", "WITHDRAWAL", "BTC", 0.05, 287000, "DEDUCTED", "DEMO-RS-2"),
      row("WazirX", "2026-05-04", "DEPOSIT", "BTC", 0.05, 287500, "NOT_APPLICABLE", "DEMO-RS-3"),
      row("WazirX", "2026-05-08", "SELL", "BTC", 0.05, 288000, "DEDUCTED", "DEMO-RS-4"),
      row("Binance", "2026-05-12", "SELL", "ETH", 1.1, 289000, "DEDUCTED", "DEMO-RS-5"),
    ],
  },
  {
    taxpayerId: "BXPQK5678L",
    taxpayerName: "Ananya Iyer",
    exchanges: ["CoinDCX", "Binance"],
    wallets: [],
    rows: [
      row("CoinDCX", "2026-05-02", "SELL", "ETH", 2.0, 520000, "DEDUCTED", "DEMO-AI-1"),
      row("CoinDCX", "2026-05-05", "WITHDRAWAL", "ETH", 1.5, 395000, "PENDING", "DEMO-AI-2"),
      row("Binance", "2026-05-06", "DEPOSIT", "ETH", 1.5, 396000, "NOT_APPLICABLE", "DEMO-AI-3"),
      row("Binance", "2026-05-09", "SELL", "MATIC", 4000, 208000, "DEDUCTED", "DEMO-AI-4", 1200),
      row("CoinDCX", "2026-05-15", "SELL", "USDT", 800, 66400, "DEDUCTED", "DEMO-AI-5"),
    ],
  },
  {
    taxpayerId: "CMNOP9012D",
    taxpayerName: "Vikram Singh",
    exchanges: ["ZebPay", "WazirX"],
    wallets: ["0x8f2a4bcf912e77a1c5d0e3b6a9f7c1234abcd88"],
    rows: [
      row("ZebPay", "2026-04-20", "SELL", "BTC", 0.3, 1710000, "PENDING", "DEMO-VS-1"),
      row("ZebPay", "2026-04-22", "WITHDRAWAL", "BTC", 0.3, 1712000, "PENDING", "DEMO-VS-2"),
      row("WazirX", "2026-04-23", "DEPOSIT", "BTC", 0.3, 1713000, "NOT_APPLICABLE", "DEMO-VS-3"),
      row("WazirX", "2026-04-25", "SELL", "BTC", 0.3, 1715000, "UNKNOWN", "DEMO-VS-4"),
      row("WazirX", "2026-04-28", "DEPOSIT", "SOL", 40, 320000, "NOT_APPLICABLE", "DEMO-VS-5"),
      row("ZebPay", "2026-05-01", "SELL", "ETH", 3.2, 840000, "PENDING", "DEMO-VS-6", 0),
    ],
  },
  {
    taxpayerId: "DQRXY3456M",
    taxpayerName: "Fatima Sheikh",
    exchanges: ["Binance", "CoinDCX"],
    wallets: [],
    rows: [
      row("Binance", "2026-05-10", "SELL", "BTC", 0.12, 684000, "PENDING", "DEMO-FS-1"),
      row("Binance", "2026-05-11", "WITHDRAWAL", "BTC", 0.12, 686000, "PENDING", "DEMO-FS-2"),
      row("CoinDCX", "2026-05-12", "DEPOSIT", "BTC", 0.12, 687000, "NOT_APPLICABLE", "DEMO-FS-3"),
      row("CoinDCX", "2026-05-14", "SELL", "BTC", 0.12, 689000, "DEDUCTED", "DEMO-FS-4"),
      row("Binance", "2026-05-18", "SELL", "ETH", 0.9, 236000, "DEDUCTED", "DEMO-FS-5"),
    ],
  },
  {
    taxpayerId: "EFTUV7890N",
    taxpayerName: "Suresh Rao",
    exchanges: ["CoinDCX", "ZebPay"],
    wallets: [],
    rows: [
      row("CoinDCX", "2026-05-06", "SELL", "USDT", 1500, 124500, "DEDUCTED", "DEMO-SR-1"),
      row("CoinDCX", "2026-05-07", "WITHDRAWAL", "USDT", 1500, 124600, "DEDUCTED", "DEMO-SR-2"),
      row("ZebPay", "2026-05-08", "DEPOSIT", "USDT", 1500, 124700, "NOT_APPLICABLE", "DEMO-SR-3"),
      row("ZebPay", "2026-05-11", "SELL", "MATIC", 2200, 114400, "DEDUCTED", "DEMO-SR-4"),
    ],
  },
];

// Deterministic 64-hex-char placeholder "hash" for seed/demo cases only —
// these were never really hashed or anchored, so this just needs to look
// like a SHA-256 digest and be stable/unique per seed string.
//
// Uses the mulberry32 PRNG (via Math.imul, so no floating-point precision
// loss) seeded from a djb2 string hash, taking the FULL 32-bit output of
// each step rather than a low-order slice. An earlier version extracted
// `x % 16` from a plain linear congruential generator each step — the low
// bits of an LCG have a period equal to that modulus, so it produced a
// 16-hex-char pattern that just repeated 4x, and two different seeds
// collided into the same repeating pattern.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return (r ^ (r >>> 14)) >>> 0;
  };
}

function fakeHash(seed) {
  let seedInt = 0;
  for (let i = 0; i < seed.length; i++) {
    seedInt = (Math.imul(seedInt, 33) + seed.charCodeAt(i)) >>> 0;
  }
  const rand = mulberry32(seedInt);
  let h = "";
  while (h.length < 64) {
    h += rand().toString(16).padStart(8, "0");
  }
  return h.slice(0, 64);
}

export function seedDemoCases() {
  const AUDITOR_POOL = ["AUD001", "AUD002"];

  return RAW_CASES.map((c, i) => {
    const reconciliation = reconcile(c.rows);
    const discrepancies = computeTdsDiscrepancies(c.rows);
    const insights = buildComplianceInsights({
      allRows: c.rows,
      reconciliation,
      discrepancies,
    });
    const narrative = generateNarrativeReport(reconciliation);
    const reportHash = fakeHash(c.taxpayerId + i);
    const anchor = mockAnchorOnChain(reportHash);

    const status =
      insights.highRiskCount > 0
        ? i % 2 === 0
          ? "high-risk"
          : "flagged"
        : i === 0
        ? "verified"
        : "pending";

    return {
      id: reportHash,
      taxpayerId: c.taxpayerId,
      taxpayerName: c.taxpayerName,
      panMasked: c.taxpayerId,
      auditorId: AUDITOR_POOL[i % AUDITOR_POOL.length],
      exchanges: c.exchanges,
      wallets: c.wallets,
      allRows: c.rows,
      reconciliation,
      discrepancies,
      insights,
      narrative,
      reportHash,
      anchor,
      status,
      reviewNote: "",
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      reviewedAt: status === "verified" ? new Date().toISOString() : null,
      demo: true,
    };
  });
}
