import assert from "node:assert/strict";
import { analyzeRows } from "../server/src/compliance/tds.js";
import { SECTION_194S_RULES } from "../shared/taxRules.js";

function sell(refId, date, inrValue, overrides = {}) {
  return {
    refId,
    date,
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    price: inrValue,
    quoteCurrency: "INR",
    tdsStatus: "UNKNOWN",
    counterparty: "buyer-1",
    ...overrides,
  };
}

const chronological = analyzeRows([
  sell("may-sale", "2025-05-10T10:00:00+05:30", 300),
  sell("april-sale", "2025-04-02T10:00:00+05:30", 100),
  sell("june-sale", "2025-06-10T10:00:00+05:30", 200),
  sell("other-buyer-sale", "2025-05-20T10:00:00+05:30", 60, { counterparty: "buyer-2" }),
], { taxpayerId: "taxpayer-1", deductorCategory: "specified_person" });

const byId = Object.fromEntries(chronological.rows.map((row) => [row.refId, row]));
assert.deepEqual(byId["april-sale"].financialYearAggregation, {
  included: true,
  financialYear: "2025-26",
  identity: { type: "counterparty", value: "buyer-1" },
  deductorCategory: "specified_person",
  previousFyConsideration: 0,
  currentTransactionConsideration: 100,
  cumulativeFyConsideration: 100,
  status: "AGGREGATED",
  reviewRequired: false,
});
assert.equal(byId["may-sale"].financialYearAggregation.previousFyConsideration, 100);
assert.equal(byId["may-sale"].financialYearAggregation.cumulativeFyConsideration, 400);
assert.equal(byId["june-sale"].financialYearAggregation.previousFyConsideration, 400);
assert.equal(byId["june-sale"].financialYearAggregation.cumulativeFyConsideration, 600);
assert.equal(byId["april-sale"].financialYearAggregation.deductorCategory, "specified_person");
assert.equal(byId["other-buyer-sale"].financialYearAggregation.previousFyConsideration, 0);
assert.equal(byId["other-buyer-sale"].financialYearAggregation.cumulativeFyConsideration, 60);

const fiscalYearBoundary = analyzeRows([
  sell("march-sale", "2026-03-31T23:59:00+05:30", 50),
  sell("april-next-fy", "2026-04-01T00:00:00+05:30", 70),
], { taxpayerId: "taxpayer-1", deductorCategory: "other_person" });
const marchRow = fiscalYearBoundary.rows[0].financialYearAggregation;
const aprilRow = fiscalYearBoundary.rows[1].financialYearAggregation;
assert.equal(marchRow.financialYear, "2025-26");
assert.equal(marchRow.cumulativeFyConsideration, 50);
assert.equal(aprilRow.financialYear, "2026-27");
assert.equal(aprilRow.deductorCategory, "other_person");
assert.equal(aprilRow.previousFyConsideration, 0);
assert.equal(aprilRow.cumulativeFyConsideration, 70);

const duplicate = analyzeRows([
  sell("duplicate-ref", "2025-04-03T10:00:00+05:30", 900),
  sell("duplicate-ref", "2025-04-02T10:00:00+05:30", 100),
], { taxpayerId: "taxpayer-1", deductorCategory: "other_person" });
const duplicateByDate = Object.fromEntries(duplicate.rows.map((row) => [row.date, row]));
assert.equal(duplicateByDate["2025-04-02T10:00:00+05:30"].financialYearAggregation.cumulativeFyConsideration, 100);
assert.equal(duplicateByDate["2025-04-03T10:00:00+05:30"].financialYearAggregation.included, false);
assert.equal(duplicateByDate["2025-04-03T10:00:00+05:30"].financialYearAggregation.exclusionReason, "DUPLICATE_TRANSACTION");

const selfTransfer = analyzeRows([{
  refId: "self-transfer",
  date: "2025-04-02T10:00:00+05:30",
  type: "WITHDRAWAL",
  asset: "ETH",
  assetType: "VDA",
  amount: 1,
  sourceOwner: "SELF",
  destinationOwner: "SELF",
  inrValue: 500,
}]);
assert.equal(selfTransfer.rows[0].transactionClassification.transferType, "OWN_VDA_MOVEMENT");
assert.equal(selfTransfer.rows[0].financialYearAggregation, undefined);

const unknown = analyzeRows([
  sell("unknown-value", "2025-04-02T10:00:00+05:30", null, {
    price: null,
    inrValue: null,
    counterparty: null,
  }),
  sell("after-unknown", "2025-04-03T10:00:00+05:30", 100, {
    counterparty: null,
  }),
], { taxpayerId: "taxpayer-1" });
assert.equal(unknown.rows[0].financialYearAggregation.deductorCategory, "unknown");
assert.equal(unknown.rows[0].financialYearAggregation.status, "REVIEW_REQUIRED");
assert.equal(unknown.rows[0].financialYearAggregation.currentTransactionConsideration, null);
assert.equal(unknown.rows[0].financialYearAggregation.cumulativeFyConsideration, null);
assert.equal(unknown.rows[1].financialYearAggregation.previousFyConsideration, null);
assert.equal(unknown.rows[1].financialYearAggregation.cumulativeFyConsideration, null);
assert.equal(unknown.rows[1].financialYearAggregation.identity.type, "taxpayer");

const invalidTimestamp = analyzeRows([
  sell("invalid-date", "invalid-date", 100),
], { taxpayerId: "taxpayer-1" });
assert.equal(invalidTimestamp.rows[0].financialYearAggregation.financialYear, null);
assert.equal(invalidTimestamp.rows[0].financialYearAggregation.status, "REVIEW_REQUIRED");
assert.equal(invalidTimestamp.rows[0].financialYearAggregation.cumulativeFyConsideration, null);

assert.ok(SECTION_194S_RULES.deductorCategories.UNKNOWN);
console.log("PASS: 194S FY aggregation, category handling, duplicates, self-transfers, and unknown values");