// Shared mock-data generator used by every exchange adapter.
//
// This exists to stand in for a real exchange's REST API during the demo —
// each adapter calls `generateRawTrades(...)` and gets back trades in *that
// exchange's own field-naming convention*, then normalizes them. That keeps
// the "pretend this is a real API response" illusion honest: two adapters
// never share a response shape, even though they share this generator.
//
// Seeded on (exchangeKey + startDate + endDate) so repeated fetches with the
// same inputs return the same data — important for a demo, so the numbers
// don't change every time someone re-runs it on stage.

const ASSETS = ["BTC", "ETH", "USDT", "MATIC", "SOL"];
const ASSET_PRICE_INR = { BTC: 5600000, ETH: 310000, USDT: 87, MATIC: 68, SOL: 14200 };

// Small deterministic string hash -> seed for a PRNG (mulberry32).
function seedFromString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates deterministic pseudo-trade records for the given exchange and
 * date window. Returns generic {date, asset, side, qty, inrValue, tdsAmount}
 * objects — each adapter reshapes these into its own field names.
 */
export function generateRawTrades({ exchangeKey, startDate, endDate, tdsAware }) {
  const rand = mulberry32(seedFromString(`${exchangeKey}:${startDate}:${endDate}`));

  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    throw new Error("Invalid date range.");
  }

  const spanDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const count = Math.min(40, Math.max(4, Math.round(spanDays / 2) + Math.floor(rand() * 6)));

  const trades = [];
  for (let i = 0; i < count; i++) {
    const t = start + Math.floor(rand() * (end - start + 1));
    const asset = ASSETS[Math.floor(rand() * ASSETS.length)];
    const side = rand() > 0.5 ? "BUY" : "SELL";
    const qty = +(rand() * (asset === "BTC" ? 0.5 : asset === "ETH" ? 3 : 500)).toFixed(6);
    const unitPriceInr = ASSET_PRICE_INR[asset];
    const inrValue = Math.round(qty * unitPriceInr);

    // Only India-facing exchanges are modeled as TDS-aware in their trade
    // history response — matches how real exchanges differ (a global
    // exchange like Binance's API has no concept of Indian TDS at all).
    const tdsAmount = tdsAware ? Math.round(inrValue * 0.01) : null;

    trades.push({
      timestampMs: t,
      asset,
      side,
      qty,
      unitPriceInr,
      inrValue,
      tdsAmount,
    });
  }

  return trades.sort((a, b) => a.timestampMs - b.timestampMs);
}
