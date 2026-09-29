import assert from "node:assert/strict";
import { reconcile } from "../src/utils/reconcile.js";

// 1. NORMAL EXCHANGE ↔ WALLET MATCH
(function testNormalMatch() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Binance",
    asset: "ETH",
    amount: 1,
    date: "2023-01-01T12:00:00Z",
    refId: "w1",
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "ETH",
    amount: 1,
    date: "2023-01-02T12:00:00Z",
    refId: "d1",
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 1);
  assert.equal(result.transferChecks[0].status, "OK");
  assert.equal(result.transferChecks[0].provenanceSupported, undefined);
  // Confidence for exact amount (60) + 1 day gap (32) = 92
  assert.equal(result.transferChecks[0].confidence, 92);
})();

// 2. PROVENANCE-SUPPORTED MATCH
(function testProvenanceSupported() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Binance",
    asset: "ETH",
    amount: 1,
    date: "2023-01-01T12:00:00Z",
    refId: "w2",
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "ETH",
    amount: 1,
    date: "2023-01-02T12:00:00Z",
    refId: "d2",
    provenanceEvidence: {
      sourceType: "EXCHANGE",
      name: "Binance", // stringified and matches wEx
    },
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 1);
  assert.equal(result.transferChecks[0].provenanceSupported, true);
  // Base 92 + 20 = 112, capped at 100
  assert.equal(result.transferChecks[0].confidence, 100);
})();

// 3. CONFLICTING EXCHANGE PROVENANCE
(function testConflictingProvenance() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Binance",
    asset: "ETH",
    amount: 1,
    date: "2023-01-01T12:00:00Z",
    refId: "w3",
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "ETH",
    amount: 1,
    date: "2023-01-02T12:00:00Z",
    refId: "d3",
    provenanceEvidence: {
      sourceType: "EXCHANGE",
      name: "CoinDCX", // knownExchange conflict
    },
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 0); // No match because isConflict is true
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].type, "ORPHANED_WITHDRAWAL");
})();

// 4. DEX/DEFI SOURCE REJECTION
(function testDexDefiSourceRejection() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Binance",
    asset: "ETH",
    amount: 1,
    date: "2023-01-01T12:00:00Z",
    refId: "w4",
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "ETH",
    amount: 1,
    date: "2023-01-02T12:00:00Z",
    refId: "d4",
    provenanceEvidence: {
      sourceType: "DEX_DEFI",
    },
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 0); // isConflict is true
})();

// 5. MISSING PROVENANCE FALLBACK
(function testMissingProvenanceFallback() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Kraken",
    asset: "BTC",
    amount: 0.5,
    date: "2023-01-01T12:00:00Z",
    refId: "w5",
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "BTC",
    amount: 0.5,
    date: "2023-01-02T12:00:00Z",
    refId: "d5",
    // No provenanceEvidence
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 1);
  assert.equal(result.transferChecks[0].provenanceSupported, undefined);
})();

// 6. TDS GAP
(function testTdsGap() {
  const w = {
    type: "WITHDRAWAL",
    exchange: "Binance",
    asset: "ETH",
    amount: 1,
    date: "2023-01-01T12:00:00Z",
    refId: "w6",
    tdsStatus: "PENDING", // Causes TDS_GAP
  };
  const d = {
    type: "DEPOSIT",
    exchange: "Wallet",
    asset: "ETH",
    amount: 1,
    date: "2023-01-02T12:00:00Z",
    refId: "d6",
  };
  const result = reconcile([w, d]);
  assert.equal(result.transferChecks.length, 1);
  assert.equal(result.transferChecks[0].status, "TDS_GAP");
  assert.equal(result.warnings.some(w => w.type === "TDS_GAP"), true);
})();

console.log("ALL PERSON 3 RECONCILIATION TESTS PASSED!");
