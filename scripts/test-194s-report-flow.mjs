import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";
import { reconcile } from "../src/utils/reconcile.js";
import { computeAllTdsRows, computeTdsDiscrepancies } from "../src/utils/tdsDiscrepancy.js";
import { buildReportPdf } from "../src/utils/exportPdf.js";

const compliance = analyzeRows([
  {
    refId: "below-threshold",
    date: "2025-04-02T10:00:00+05:30",
    exchange: "CEX",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    price: 5000,
    quoteCurrency: "INR",
    tdsStatus: "UNKNOWN",
    counterparty: "buyer-1",
  },
  {
    refId: "crossed-threshold",
    date: "2025-04-03T10:00:00+05:30",
    exchange: "DEX",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    price: 6000,
    quoteCurrency: "INR",
    tdsStatus: "UNKNOWN",
    counterparty: "buyer-1",
    transactionSource: "DECENTRALIZED_DEX",
  },
], {
  taxpayerId: "taxpayer-1",
  deductorCategory: "other_person",
});

assert.equal(compliance.tdsRows[0].expectedTds, 0);
assert.equal(compliance.tdsRows[1].expectedTds, 60);
assert.deepEqual(
  computeAllTdsRows(compliance.rows).map((row) => row.expectedTds),
  compliance.tdsRows.map((row) => row.expectedTds)
);
const discrepancies = computeTdsDiscrepancies(compliance.rows);
assert.equal(discrepancies.length, 1);
assert.equal(discrepancies[0].transactionId, "crossed-threshold");
assert.equal(discrepancies[0].expectedTds, 60);
assert.equal(discrepancies[0].type, "TDS_MISMATCH");

const reportReconciliation = {
  ...reconcile(compliance.rows),
  tdsRows: compliance.tdsRows,
};
assert.equal(reportReconciliation.tdsRows[0].threshold_status, "BELOW_THRESHOLD");
assert.equal(reportReconciliation.tdsRows[1].threshold_status, "THRESHOLD_CROSSED");

const pdf = buildReportPdf({
  ...reportReconciliation,
  narrative: "OVERALL ASSESSMENT\nNo discrepancies identified.",
  reportHash: "test-report-hash",
  anchor: null,
});
assert.ok(pdf.output("arraybuffer").byteLength > 0);

console.log("PASS: 194S TDS results flow through discrepancy, report reconciliation data, and PDF generation");