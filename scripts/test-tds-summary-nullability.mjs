import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";

function sell(overrides = {}) {
  return {
    exchange: "Test Exchange",
    date: "2025-05-10T10:00:00+05:30",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    counterparty: "test-buyer",
    deductorCategory: "other_person",
    tdsStatus: "DEDUCTED",
    refId: `test-${Math.random()}`,
    ...overrides,
  };
}

const allKnown = analyzeRows([
  sell({ inrValue: 20000, unitPrice: 20000, quoteCurrency: "INR" }),
  sell({ inrValue: 30000, unitPrice: 30000, quoteCurrency: "INR" }),
]);
assert.equal(allKnown.summary.expectedTds, 500);
assert.equal(allKnown.summary.reportedTds, 500);

const genuineZero = analyzeRows([sell({ inrValue: 0, unitPrice: 0, quoteCurrency: "INR" })]);
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
