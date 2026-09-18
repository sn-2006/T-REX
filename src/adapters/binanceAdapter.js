import { generateRawTrades } from "./mockData";
import { withDeterminedConsideration } from "../utils/consideration.js";

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

// Convert a real Binance myTrades response
// into the raw shape expected by the existing T-REX normalizer.
function toBinanceRaw(trade, idx) {
  const symbol = trade.symbol || "";

  let quoteAsset = "USDT";

  if (symbol.endsWith("USDT")) {
    quoteAsset = "USDT";
  } else if (symbol.endsWith("BTC")) {
    quoteAsset = "BTC";
  } else if (symbol.endsWith("FDUSD")) {
    quoteAsset = "FDUSD";
  }

  return {
    id: `BNB-${trade.id ?? idx}`,
    symbol,
    isBuyer: Boolean(trade.isBuyer),
    qty: Number(trade.qty || 0),
    quoteQty: Number(trade.quoteQty || 0),
    price: Number(trade.price || 0),
    quoteAsset,
    fxRateInr: 87,
    time: Number(trade.time),
  };
}

function normalize(raw) {
  const asset = raw.symbol.endsWith(raw.quoteAsset)
    ? raw.symbol.slice(0, -raw.quoteAsset.length)
    : raw.symbol;

  return withDeterminedConsideration({
    exchange: "Binance",
    date: new Date(raw.time).toISOString().slice(0, 10),

    type: raw.isBuyer ? "BUY" : "SELL",

    asset,
    amount: raw.qty,

    // Binance quoteQty is normally in USDT/BTC/etc.
    // Convert to INR using the supplied FX rate.
    inrValue: Math.round(raw.quoteQty * raw.fxRateInr),

    price: raw.price,

    quoteCurrency: raw.quoteAsset,
    fxRateInr: raw.fxRateInr,

    // Binance's API does not provide Indian TDS information.
    tdsStatus: "UNKNOWN",
    tdsAmount: null,

    refId: raw.id,
  });
}

export async function fetchTransactions({
  apiKey,
  apiSecret,
  startDate,
  endDate,
}) {
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    throw new Error(
      "Binance API key and secret are required."
    );
  }

  if (!startDate || !endDate) {
    throw new Error(
      "Start date and end date are required."
    );
  }

  // Keep the existing mock functionality available.
  if (DEMO_MODE) {
    await new Promise((resolve) =>
      setTimeout(resolve, 700 + Math.random() * 500)
    );

    const rawTrades = generateRawTrades({
      exchangeKey: "binance",
      startDate,
      endDate,
      tdsAware: false,
    }).map(toBinanceRaw);

    return rawTrades.map(normalize);
  }

  // REAL BINANCE API
  const response = await fetch("/api/binance/trades", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey,
      apiSecret,
      from: startDate,
      to: endDate,
    }),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Invalid response from T-REX Binance server (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `Binance request failed (${response.status}).`
    );
  }

  const trades = data.transactions || [];

  return trades
    .map(toBinanceRaw)
    .map(normalize);
}