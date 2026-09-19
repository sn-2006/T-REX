import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";

function sell(overrides = {}) {
  return {
    exchange: "Test Exchange",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    tdsStatus: "DEDUCTED",
    refId: `test-${Math.random()}`,
    ...overrides,
  };
}

const allKnown = analyzeRows([
  sell({ inrValue: 100, unitPrice: 100, quoteCurrency: "INR" }),
  sell({ inrValue: 200, unitPrice: 200, quoteCurrency: "INR" }),
]);
assert.equal(allKnown.summary.expectedTds, 3);
assert.equal(allKnown.summary.reportedTds, 3);

const genuineZero = analyzeRows([sell({ inrValue: 0 })]);
assert.equal(genuineZero.summary.expectedTds, 0);
assert.equal(genuineZero.summary.reportedTds, 0);

const partiallyUnknown = analyzeRows([
  sell({ inrValue: 100 }),
  sell({
    refId: "test-unresolved",
    asset: "USDC",
    tdsStatus: "NOT_REPORTED",
    transactionSource: "DECENTRALIZED_DEX",
  }),
]);
assert.equal(partiallyUnknown.summary.expectedTds, null);
assert.equal(partiallyUnknown.summary.reportedTds, null);

const allUnknown = analyzeRows([
  sell({
    refId: "test-unresolved-only",
    tdsStatus: "NOT_REPORTED",
    transactionSource: "DECENTRALIZED_DEX",
  }),
]);
assert.equal(allUnknown.summary.expectedTds, null);
assert.equal(allUnknown.summary.reportedTds, null);

console.log("PASS: TDS summary preserves known totals, genuine zero, partial unknown, and all unknown values");
console.log(`All known: expected=${allKnown.summary.expectedTds}, reported=${allKnown.summary.reportedTds}`);
console.log(`Genuine zero: expected=${genuineZero.summary.expectedTds}, reported=${genuineZero.summary.reportedTds}`);
console.log(`Partially unknown: expected=${partiallyUnknown.summary.expectedTds}, reported=${partiallyUnknown.summary.reportedTds}`);
console.log(`All unknown: expected=${allUnknown.summary.expectedTds}, reported=${allUnknown.summary.reportedTds}`);
