import assert from "node:assert/strict";
import { resolveHistoricalInrValuation } from "../server/src/services/inrValuation.js";

const verified = await resolveHistoricalInrValuation({
  asset: "USDC",
  amount: 100,
  date: "2026-08-20T12:00:00.000Z",
  actualInrReceived: 8400,
  actualInrEvidence: { type: "bank_settlement", provider: "test-bank" },
});
assert.equal(verified.valuationStatus, "VERIFIED_INR");
assert.equal(verified.actualInrReceived, 8400);
assert.equal(verified.estimatedInrValue, null);

const estimated = await resolveHistoricalInrValuation({
  asset: "USDC",
  amount: 100,
  date: "2026-08-20T12:00:00.000Z",
  fxRateInr: 84.2,
});
assert.equal(estimated.valuationStatus, "ESTIMATED_INR");
assert.equal(estimated.actualInrReceived, null);
assert.equal(estimated.estimatedInrValue, 8420);
assert.equal(estimated.valuationEvidence.priceCurrency, "USD");
assert.equal(estimated.valuationEvidence.currency, "INR");
assert.match(estimated.valuationEvidence.provenance, /no fiat settlement evidence/);

const missingPrice = await resolveHistoricalInrValuation({
  asset: "UNKNOWN_ASSET",
  amount: 1,
  date: "2026-08-20T12:00:00.000Z",
  fxRateInr: 84.2,
});
assert.equal(missingPrice.valuationStatus, "PENDING_VALUATION");
assert.equal(missingPrice.estimatedInrValue, null);

const transferOnly = await resolveHistoricalInrValuation({
  asset: "ETH",
  amount: null,
  date: "2026-08-20T12:00:00.000Z",
  fxRateInr: 84.2,
});
assert.equal(transferOnly.valuationStatus, "UNAVAILABLE");
assert.equal(transferOnly.actualInrReceived, null);

const inrPegged = await resolveHistoricalInrValuation({
  asset: "INRT",
  amount: 100,
  date: "2026-08-20T12:00:00.000Z",
  fxRateInr: 84.2,
});
assert.equal(inrPegged.valuationStatus, "PENDING_VALUATION");
assert.equal(inrPegged.estimatedInrValue, null);

console.log("PASS: verified INR, estimated INR, missing price, transfer-only, stablecoin, and INR-pegged evidence cases");
