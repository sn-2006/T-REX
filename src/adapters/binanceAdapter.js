import { generateRawTrades } from "./mockData";
import { withDeterminedConsideration } from "../utils/consideration.js";

// Mocks Binance's myTrades endpoint shape:
// GET /api/v3/myTrades?symbol=...&startTime=...&endTime=...
// [{ id, symbol, isBuyer, qty, quoteQty, time }]
//
// Deliberately NOT TDS-aware — Binance is a global exchange with no concept
// of Indian TDS in its API. Every row normalizes to tdsStatus "UNKNOWN".
// This is realistic, and it's actually a useful demo case: it shows the
// reconciliation engine correctly flagging "no TDS info available" for a
// leg that passed through a non-Indian platform, rather than silently
// assuming compliance.
function toBinanceRaw(trade, idx) {
  return {
    id: `BNB-${trade.timestampMs}-${idx}`,
    symbol: `${trade.asset}USDT`,
    isBuyer: trade.side === "BUY",
    qty: trade.qty,
    quoteQty: +(trade.inrValue / 87).toFixed(2), // rough INR->USDT for realism
    price: +(trade.unitPriceInr / 87).toFixed(6),
    quoteAsset: "USDT",
    fxRateInr: 87,
    time: trade.timestampMs,
  };
}

function normalize(raw) {
  return withDeterminedConsideration({
    exchange: "Binance",
    date: new Date(raw.time).toISOString().slice(0, 10),
    type: raw.isBuyer ? "BUY" : "SELL",
    asset: raw.symbol.replace("USDT", ""),
    amount: raw.qty,
    inrValue: Math.round(raw.quoteQty * 87),
    price: raw.price,
    quoteCurrency: raw.quoteAsset,
    fxRateInr: raw.fxRateInr,
    tdsStatus: "UNKNOWN",
    tdsAmount: null,
    refId: raw.id,
  });
}

export async function fetchTransactions({ apiKey, apiSecret, startDate, endDate }) {
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    throw new Error("Binance API key and secret are required.");
  }

  await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));

  const rawTrades = generateRawTrades({
    exchangeKey: "binance",
    startDate,
    endDate,
    tdsAware: false,
  }).map(toBinanceRaw);

  return rawTrades.map(normalize);
}
