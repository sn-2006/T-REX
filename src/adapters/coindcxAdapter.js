import { generateRawTrades } from "./mockData";
import { withDeterminedConsideration } from "../utils/consideration.js";

// Mocks CoinDCX's trade-history endpoint shape:
// POST /exchange/v1/orders/trade_history
// [{ trade_id, market, order_type, quantity, total_price, timestamp, tds_deducted_inr }]
//
// India-facing, so also TDS-aware — but with different field names to
// WazirX's, on purpose: the whole point of the adapter layer is that every
// exchange gets to keep its own shape right up until normalize() runs.
function toCoinDcxRaw(trade, idx) {
  return {
    trade_id: `CDX-${trade.timestampMs}-${idx}`,
    market: `${trade.asset}INR`,
    order_type: trade.side.toLowerCase(),
    quantity: trade.qty,
    total_price: trade.inrValue,
    unit_price: trade.unitPriceInr,
    quote_asset: "INR",
    timestamp: trade.timestampMs,
    tds_deducted_inr: trade.tdsAmount,
  };
}

function normalize(raw) {
  return withDeterminedConsideration({
    exchange: "CoinDCX",
    date: new Date(raw.timestamp).toISOString().slice(0, 10),
    type: raw.order_type.toUpperCase(),
    asset: raw.market.replace("INR", ""),
    amount: raw.quantity,
    inrValue: raw.total_price,
    price: raw.unit_price,
    quoteCurrency: raw.quote_asset,
    tdsStatus: raw.tds_deducted_inr != null ? "DEDUCTED" : "UNKNOWN",
    tdsAmount: raw.tds_deducted_inr,
    refId: raw.trade_id,
  });
}

export async function fetchTransactions({ apiKey, apiSecret, startDate, endDate }) {
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    throw new Error("CoinDCX API key and secret are required.");
  }

  await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));

  const rawTrades = generateRawTrades({
    exchangeKey: "coindcx",
    startDate,
    endDate,
    tdsAware: true,
  }).map(toCoinDcxRaw);

  return rawTrades.map(normalize);
}
