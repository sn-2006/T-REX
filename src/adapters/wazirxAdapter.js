import { generateRawTrades } from "./mockData";
import { withDeterminedConsideration } from "../utils/consideration.js";

// Mocks WazirX's trade-history endpoint shape:
// GET /sapi/v1/myTrades?symbol=...&startTime=...&endTime=...
// [{ id, symbol, side, executedQty, quoteQty, time, tdsAmountInr }]
//
// WazirX is India-facing, so its (mocked) response includes a TDS field —
// unlike an international exchange's API.
function toWazirxRaw(trade, idx) {
  return {
    id: `WZX-${trade.timestampMs}-${idx}`,
    symbol: `${trade.asset}INR`,
    side: trade.side,
    executedQty: trade.qty,
    quoteQty: trade.inrValue,
    price: trade.unitPriceInr,
    quoteAsset: "INR",
    time: trade.timestampMs,
    tdsAmountInr: trade.tdsAmount,
  };
}

function normalize(raw) {
  return withDeterminedConsideration({
    exchange: "WazirX",
    date: new Date(raw.time).toISOString().slice(0, 10),
    type: raw.side,
    asset: raw.symbol.replace("INR", ""),
    amount: raw.executedQty,
    inrValue: raw.quoteQty,
    price: raw.price,
    quoteCurrency: raw.quoteAsset,
    tdsStatus: raw.tdsAmountInr != null ? "DEDUCTED" : "UNKNOWN",
    tdsAmount: raw.tdsAmountInr,
    refId: raw.id,
  });
}

export async function fetchTransactions({ apiKey, apiSecret, startDate, endDate }) {
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    throw new Error("WazirX API key and secret are required.");
  }

  // Simulated network latency, like a real API call.
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));

  const rawTrades = generateRawTrades({
    exchangeKey: "wazirx",
    startDate,
    endDate,
    tdsAware: true,
  }).map(toWazirxRaw);

  return rawTrades.map(normalize);
}
