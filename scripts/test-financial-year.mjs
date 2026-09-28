import assert from "node:assert/strict";
import { getIndianFinancialYear } from "../shared/financialYear.js";
import { SECTION_194S_RULES } from "../shared/taxRules.js";

assert.equal(SECTION_194S_RULES.tdsRate, 0.01);
assert.equal(SECTION_194S_RULES.thresholdInr.specifiedPerson, 50000);
assert.equal(SECTION_194S_RULES.thresholdInr.otherPerson, 10000);

assert.equal(getIndianFinancialYear("2025-03-31T12:00:00+05:30"), "2024-25");
assert.equal(getIndianFinancialYear("2025-04-01T00:00:00+05:30"), "2025-26");
assert.equal(getIndianFinancialYear("2025-11-15T09:30:00+05:30"), "2025-26");
assert.equal(getIndianFinancialYear("2025-03-31T18:30:00.000Z"), "2025-26");
assert.equal(getIndianFinancialYear(null), null);
assert.equal(getIndianFinancialYear(undefined), null);
assert.equal(getIndianFinancialYear("not-a-timestamp"), null);

console.log("PASS: Section 194S rules and Indian financial-year boundary cases");