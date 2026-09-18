import Papa from "papaparse";
import { withDeterminedConsideration } from "./consideration.js";

// Parses a single exchange CSV export into a normalized array of transaction rows.
// Expected columns: date, type, asset, amount, inr_value, tds_status, ref_id
// Optional column: tds_amount (actual INR TDS deducted, if the exchange
// reports it) — used by utils/tdsDiscrepancy.js to compare against the
// expected 1% figure instead of just trusting the tds_status flag.
export function parseExchangeCSV(fileText, exchangeName) {
  const result = Papa.parse(fileText.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (result.errors && result.errors.length > 0) {
    console.warn("CSV parse warnings:", result.errors);
  }

  return result.data.map((row, idx) =>
    withDeterminedConsideration({
      exchange: exchangeName,
      date: row.date,
      type: (row.type || "").toUpperCase(),
      asset: (row.asset || "").toUpperCase(),
      assetType: row.asset_type || row.asset_category || null,
      amount: Number(row.amount) || 0,
      price: row.price !== undefined && row.price !== "" ? Number(row.price) : null,
      quoteCurrency: row.quote_currency || row.quote_asset || row.price_currency || "INR",
      source: row.source || row.source_address || null,
      destination: row.destination || row.destination_address || null,
      sourceOwner: row.source_owner || row.from_owner || null,
      destinationOwner: row.destination_owner || row.to_owner || null,
      ownershipChanged: row.ownership_changed !== undefined && row.ownership_changed !== ""
        ? row.ownership_changed
        : null,
      counterparty: row.counterparty || null,
      fxRateInr:
        row.fx_rate_inr !== undefined && row.fx_rate_inr !== ""
          ? Number(row.fx_rate_inr)
          : null,
      receivedAsset: (row.received_asset || "").toUpperCase() || null,
      receivedAssetType: row.received_asset_type || null,
      receivedAmount:
        row.received_amount !== undefined && row.received_amount !== ""
          ? Number(row.received_amount)
          : null,
      receivedAssetFmvInrPerUnit:
        row.received_asset_fmv_inr_per_unit !== undefined &&
        row.received_asset_fmv_inr_per_unit !== ""
          ? Number(row.received_asset_fmv_inr_per_unit)
          : null,
      // Preserve a missing source value as null. Zero means an actual zero, not unknown.
      inrValue:
        row.inr_value !== undefined && row.inr_value !== "" && row.inr_value !== null
          ? Number(row.inr_value)
          : null,
      tdsStatus: (row.tds_status || "UNKNOWN").toUpperCase(),
      tdsAmount:
        row.tds_amount !== undefined && row.tds_amount !== ""
          ? Number(row.tds_amount)
          : null,
      refId: row.ref_id || `${exchangeName}-${idx}`,
    })
  );
}

export function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.abs((a - b) / (1000 * 60 * 60 * 24));
}
