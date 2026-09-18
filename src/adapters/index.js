import * as wazirx from "./wazirxAdapter";
import * as coindcx from "./coindcxAdapter";
import * as binance from "./binanceAdapter";

// Registry the UI reads from to populate the exchange dropdown, and to look
// up the right adapter when the user hits "Fetch transactions".
//
// Every adapter here exposes the same contract:
//   fetchTransactions({ apiKey, apiSecret, startDate, endDate })
//     -> Promise<NormalizedRow[]>
// where NormalizedRow matches parseExchangeCSV's output shape exactly
// (exchange, date, type, asset, amount, inrValue, tdsStatus, tdsAmount, refId).
// That's what lets an API-fetched exchange and a CSV-uploaded exchange feed
// the same reconciliation pipeline with zero branching downstream.
//
// Today these adapters generate deterministic mock data shaped like each
// exchange's real API. Swapping a mock adapter for a real one later means
// rewriting only that one file — the registry contract, and everything that
// calls it, stays the same.
export const SUPPORTED_API_EXCHANGES = [
  { key: "wazirx", label: "WazirX", module: wazirx },
  { key: "coindcx", label: "CoinDCX", module: coindcx },
  { key: "binance", label: "Binance", module: binance },
];

export function getExchangeAdapter(key) {
  const entry = SUPPORTED_API_EXCHANGES.find((e) => e.key === key);
  if (!entry) throw new Error(`No API adapter registered for "${key}".`);
  return entry.module;
}

export async function fetchExchangeTransactions(key, { apiKey, apiSecret, startDate, endDate }) {
  const adapter = getExchangeAdapter(key);
  return adapter.fetchTransactions({ apiKey, apiSecret, startDate, endDate });
}
