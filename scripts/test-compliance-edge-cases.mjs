import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";
import { reconcile } from "../src/utils/reconcile.js";
import { computeAllTdsRows, computeTdsDiscrepancies } from "../src/utils/tdsDiscrepancy.js";
import { buildTransactionEvidence } from "../src/utils/evidenceBuilder.js";

function sell(overrides = {}) {
  return {
    exchange: "Test Exchange",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    refId: "test-sale",
    ...overrides,
  };
}

const unresolvedInput = sell({
  refId: "dex-unresolved",
  receivedAsset: "USDC",
  receivedAssetType: "VDA",
  receivedAmount: 500,
  tdsStatus: "NOT_REPORTED",
  transactionSource: "DECENTRALIZED_DEX",
});
const unresolvedCompliance = analyzeRows([unresolvedInput]);
const unresolvedTds = unresolvedCompliance.tdsRows[0];
assert.equal(unresolvedTds.expectedTds, null);
assert.equal(unresolvedTds.reportedTds, null);
assert.equal(unresolvedTds.status, "REVIEW_REQUIRED");
assert.equal(unresolvedTds.hasTdsDiscrepancy, false);
assert.equal(unresolvedCompliance.summary.expectedTds, null);
assert.equal(unresolvedCompliance.summary.reportedTds, null);
const legacyUnresolvedTds = computeAllTdsRows([{
  ...unresolvedInput,
  consideration: undefined,
  inrValue: null,
  transactionClassification: { isVdaTransfer: true },
}])[0];
assert.equal(legacyUnresolvedTds.expectedTds, null);
assert.equal(legacyUnresolvedTds.reportedTds, null);

const unresolvedReconciliation = reconcile(unresolvedCompliance.rows);
assert.equal(unresolvedReconciliation.transferChecks.length, 0);
assert.equal(unresolvedReconciliation.warnings[0].type, "VALUATION_UNRESOLVED");
const unresolvedEvidence = buildTransactionEvidence(unresolvedReconciliation.warnings[0], {
  reconciliation: unresolvedReconciliation,
  allRows: unresolvedCompliance.rows,
});
assert.equal(unresolvedEvidence.ruleTriggered, "INR valuation required before expected TDS can be determined");
assert.equal(unresolvedEvidence.matchingConfidence, null);
assert.equal(unresolvedEvidence.status, "VALUATION_UNRESOLVED");
assert.equal(unresolvedEvidence.closestCandidate, null);

const equalKnown = analyzeRows([sell({
  refId: "equal-known",
  inrValue: 100,
  unitPrice: 100,
  quoteCurrency: "INR",
  tdsStatus: "DEDUCTED",
})]);
assert.equal(equalKnown.tdsRows[0].expectedTds, 1);
assert.equal(equalKnown.tdsRows[0].reportedTds, 1);
assert.equal(equalKnown.tdsRows[0].difference, 0);
assert.equal(equalKnown.tdsRows[0].status, "MATCHED");
assert.equal(computeTdsDiscrepancies(equalKnown.rows).length, 0);

const unequalKnown = analyzeRows([sell({
  refId: "unequal-known",
  inrValue: 100,
  unitPrice: 100,
  quoteCurrency: "INR",
  tdsStatus: "DEDUCTED",
  tdsAmount: 0,
})]);
assert.equal(unequalKnown.tdsRows[0].expectedTds, 1);
assert.equal(unequalKnown.tdsRows[0].reportedTds, 0);
assert.equal(unequalKnown.tdsRows[0].status, "TDS_MISMATCH");
assert.equal(computeTdsDiscrepancies(unequalKnown.rows).length, 1);

const missingReported = analyzeRows([sell({
  refId: "missing-reported",
  inrValue: 100,
  unitPrice: 100,
  quoteCurrency: "INR",
  tdsStatus: "PENDING",
})]);
assert.equal(missingReported.tdsRows[0].expectedTds, 1);
assert.equal(missingReported.tdsRows[0].reportedTds, null);
assert.equal(missingReported.tdsRows[0].status, "REVIEW_REQUIRED");
assert.equal(computeTdsDiscrepancies(missingReported.rows).length, 0);

const mixed = analyzeRows([
  sell({ refId: "mixed-known", inrValue: 100, unitPrice: 100, quoteCurrency: "INR", tdsStatus: "DEDUCTED" }),
  sell({ refId: "mixed-unknown", asset: "USDC", tdsStatus: "NOT_REPORTED", transactionSource: "DECENTRALIZED_DEX" }),
]);
assert.equal(mixed.summary.expectedTds, null);
assert.equal(mixed.summary.reportedTds, null);
assert.equal(computeAllTdsRows(mixed.rows).filter((row) => row.reviewRequired).length, 1);

const zero = analyzeRows([sell({
  refId: "genuine-zero",
  inrValue: 0,
  tdsStatus: "DEDUCTED",
})]);
assert.equal(zero.tdsRows[0].expectedTds, 0);
assert.equal(zero.tdsRows[0].reportedTds, 0);
assert.equal(zero.tdsRows[0].status, "MATCHED");
assert.equal(zero.summary.expectedTds, 0);
assert.equal(zero.summary.reportedTds, 0);

console.log("PASS: unresolved DEX, TDS statuses, transfer eligibility, AI evidence, mixed aggregates, and genuine zero cases");
