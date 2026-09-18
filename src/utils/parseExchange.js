import Papa from "papaparse";

// Parses a single exchange CSV export into a normalized array of transaction rows.
// Expected columns: date, type, asset, amount, inr_value, tds_status, ref_id
export function parseExchangeCSV(fileText, exchangeName) {
  const result = Papa.parse(fileText.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (result.errors && result.errors.length > 0) {
    console.warn("CSV parse warnings:", result.errors);
  }

  return result.data.map((row, idx) => ({
    exchange: exchangeName,
    date: row.date,
    type: (row.type || "").toUpperCase(),
    asset: (row.asset || "").toUpperCase(),
    amount: Number(row.amount) || 0,
    inrValue: Number(row.inr_value) || 0,
    tdsStatus: (row.tds_status || "UNKNOWN").toUpperCase(),
    refId: row.ref_id || `${exchangeName}-${idx}`,
  }));
}

export function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.abs((a - b) / (1000 * 60 * 60 * 24));
}
