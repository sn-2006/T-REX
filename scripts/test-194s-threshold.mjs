import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";
import { computeAllTdsRows } from "../src/utils/tdsDiscrepancy.js";

function sell(refId, amount, overrides = {}) {
  return {
    refId,
    date: "2025-05-10T10:00:00+05:30",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    price: amount,
    quoteCurrency: "INR",
    tdsStatus: "UNKNOWN",
    counterparty: "buyer-1",
    ...overrides,
  };
}

function analyze(sales, deductorCategory) {
  return analyzeRows(sales, {
    taxpayerId: "taxpayer-1",
    deductorCategory,
  });
}

function threshold(result, refId) {
  return result.rows.find((row) => row.refId === refId);
}

for (const [category, values, expected] of [
  ["specified_person", [49999, 50000, 50001], ["BELOW_THRESHOLD", "BELOW_THRESHOLD", "THRESHOLD_CROSSED"]],
  ["other_person", [9999, 10000, 10001], ["BELOW_THRESHOLD", "BELOW_THRESHOLD", "THRESHOLD_CROSSED"]],
]) {
  for (let index = 0; index < values.length; index += 1) {
    const refId = `${category}-${values[index]}`;
    const result = analyze([sell(refId, values[index])], category);
    const row = threshold(result, refId);
    assert.equal(row.threshold_status, expected[index]);
    assert.equal(row.is_194s_applicable, values[index] > (category === "specified_person" ? 50000 : 10000));
    assert.equal(row.threshold_crossed, values[index] > (category === "specified_person" ? 50000 : 10000));
    assert.equal(row.threshold_exceeded_amount, Math.max(0, values[index] - (category === "specified_person" ? 50000 : 10000)));
    assert.equal(result.tdsRows[0].expectedTds, values[index] > (category === "specified_person" ? 50000 : 10000) ? values[index] * 0.01 : 0);
  }
}

const cumulative = analyze([
  sell("first", 8000, { date: "2025-04-02T10:00:00+05:30" }),
  sell("crossing", 3000, { date: "2025-05-02T10:00:00+05:30" }),
  sell("already-crossed", 1000, { date: "2025-06-02T10:00:00+05:30" }),
], "other_person");
const first = threshold(cumulative, "first");
const crossing = threshold(cumulative, "crossing");
const alreadyCrossed = threshold(cumulative, "already-crossed");
assert.equal(first.cumulative_fy_consideration, 8000);
assert.equal(first.remaining_threshold_before_transaction, 10000);
assert.equal(crossing.previous_fy_consideration, 8000);
assert.equal(crossing.current_consideration, 3000);
assert.equal(crossing.cumulative_fy_consideration, 11000);
assert.equal(crossing.remaining_threshold_before_transaction, 2000);
assert.equal(crossing.threshold_exceeded_amount, 1000);
assert.equal(crossing.threshold_status, "THRESHOLD_CROSSED");
assert.equal(crossing.threshold_crossed, true);
assert.equal(alreadyCrossed.previous_fy_consideration, 11000);
assert.equal(alreadyCrossed.cumulative_fy_consideration, 12000);
assert.equal(alreadyCrossed.threshold_status, "ALREADY_CROSSED");
assert.equal(alreadyCrossed.threshold_crossed, false);
assert.equal(alreadyCrossed.threshold_exceeded_amount, 2000);
const crossingTdsRow = cumulative.tdsRows.find((row) => row.transactionId === "crossing");
assert.equal(crossingTdsRow.expectedTds, 30);
assert.equal(crossingTdsRow.threshold_status, "THRESHOLD_CROSSED");
assert.equal(crossingTdsRow.cumulative_fy_consideration, 11000);
assert.equal(cumulative.tdsRows.find((row) => row.transactionId === "already-crossed").expectedTds, 10);

const unknownCategory = threshold(analyze([sell("unknown-category", 20000)]), "unknown-category");
assert.equal(unknownCategory.threshold_amount, null);
assert.equal(unknownCategory.is_194s_applicable, null);
assert.equal(unknownCategory.threshold_crossed, null);
assert.equal(unknownCategory.threshold_status, "REVIEW_REQUIRED");
assert.equal(analyze([sell("unknown-category-tds", 20000)]).tdsRows[0].expectedTds, null);

const unknownConsideration = threshold(analyze([
  sell("unknown-consideration", null, { price: null, inrValue: null }),
], "other_person"), "unknown-consideration");
assert.equal(unknownConsideration.current_consideration, null);
assert.equal(unknownConsideration.cumulative_fy_consideration, null);
assert.equal(unknownConsideration.is_194s_applicable, null);
assert.equal(unknownConsideration.threshold_exceeded_amount, null);
assert.equal(unknownConsideration.threshold_status, "REVIEW_REQUIRED");
assert.equal(analyze([
  sell("unknown-consideration-tds", null, { price: null, inrValue: null }),
], "other_person").tdsRows[0].expectedTds, null);

const centralizedAndDex = analyze([
  sell("centralized-before-crossing", 6000),
  sell("dex-crossing", 5000, {
    date: "2025-05-11T10:00:00+05:30",
    transactionSource: "DECENTRALIZED_DEX",
  }),
], "other_person");
assert.equal(threshold(centralizedAndDex, "centralized-before-crossing").threshold_status, "BELOW_THRESHOLD");
assert.equal(threshold(centralizedAndDex, "dex-crossing").threshold_status, "THRESHOLD_CROSSED");
assert.equal(centralizedAndDex.tdsRows.find((row) => row.transactionId === "centralized-before-crossing").expectedTds, 0);
assert.equal(centralizedAndDex.tdsRows.find((row) => row.transactionId === "dex-crossing").expectedTds, 50);
const browserTdsRows = computeAllTdsRows(centralizedAndDex.rows);
assert.deepEqual(
  browserTdsRows.map((row) => row.expectedTds),
  centralizedAndDex.tdsRows.map((row) => row.expectedTds)
);

const separateYears = analyze([
  sell("march", 9000, { date: "2026-03-31T23:59:00+05:30" }),
  sell("april", 2000, { date: "2026-04-01T00:00:00+05:30" }),
], "other_person");
assert.equal(threshold(separateYears, "march").cumulative_fy_consideration, 9000);
assert.equal(threshold(separateYears, "april").previous_fy_consideration, 0);
assert.equal(threshold(separateYears, "april").threshold_status, "BELOW_THRESHOLD");

console.log("PASS: Section 194S thresholds, cumulative FY eligibility, unknowns, and FY separation");