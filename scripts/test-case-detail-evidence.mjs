import assert from "node:assert/strict";
import {
  buildCaseTransactionEvidence,
  buildTransactionEvidence,
  resolveCaseWalletAnalyses,
} from "../src/utils/evidenceBuilder.js";

const walletAnalyses = {
  "wallet-1": {
    transferCount: 2,
    chain: { name: "Ethereum" },
    traceability: {
      pendingReviewCount: 2,
      inventory: [
        {
          rawTransferId: "pending-full",
          txHash: "0xdeadbeef",
          timestamp: "2026-08-20T12:00:00.000Z",
          asset: "DAI",
          amount: 10,
          from: "0xrouter",
          to: "0xwallet",
          direction: "IN",
          status: "PENDING_MANUAL_REVIEW",
          reason: "ownership unknown",
          evidenceSources: ["Alchemy asset transfer"],
        },
        {
          rawTransferId: "pending-sparse",
          txHash: null,
          timestamp: null,
          asset: "ETH",
          amount: 0.05,
          from: "0xwallet",
          to: null,
          direction: "OUT",
          status: "PENDING_MANUAL_REVIEW",
          reason: "ownership unknown",
        },
      ],
    },
  },
};

const reconciliation = {
  tradeSummary: [],
  transferChecks: [],
  unmatchedDeposits: [],
  warnings: [
    {
      type: "PENDING_MANUAL_REVIEW",
      refId: "pending-full",
      message: "pending-full: requires manual review",
    },
    {
      type: "PENDING_MANUAL_REVIEW",
      refId: "pending-sparse",
      message: "pending-sparse: requires manual review",
    },
  ],
  // Snapshot shape written by TaxpayerDashboard at case save time.
  walletAnalyses,
};

const caseFromApi = {
  id: "case-hash",
  allRows: [],
  reconciliation,
  // Top-level field restored by server rowToCase / upsert payload.
  walletAnalyses,
  discrepancies: [],
  insights: {
    overallConfidence: 40,
    confidenceMethod: "heuristic_evidence_completeness",
    confidenceIsHeuristic: true,
    confidenceLimitations:
      "Deterministic heuristic from available reconciliation signals. Not a statistically validated probability.",
  },
};

const caseEmbeddedOnly = {
  id: "case-embedded",
  allRows: [],
  reconciliation,
  // No top-level walletAnalyses — must recover from reconciliation snapshot.
  discrepancies: [],
};

assert.deepEqual(resolveCaseWalletAnalyses(caseFromApi), walletAnalyses);
assert.deepEqual(resolveCaseWalletAnalyses(caseEmbeddedOnly), walletAnalyses);
assert.deepEqual(resolveCaseWalletAnalyses({}), {});

const fullEvidence = buildCaseTransactionEvidence(
  caseFromApi,
  reconciliation.warnings[0]
);
assert.equal(fullEvidence.status, "PENDING_MANUAL_REVIEW");
assert.equal(fullEvidence.asset, "DAI");
assert.equal(fullEvidence.quantity, 10);
assert.equal(fullEvidence.date, "2026-08-20T12:00:00.000Z");
assert.equal(fullEvidence.txHash, "0xdeadbeef");
assert.equal(fullEvidence.direction, "IN");
assert.equal(fullEvidence.from, "0xrouter");
assert.equal(fullEvidence.to, "0xwallet");

const sparseEvidence = buildCaseTransactionEvidence(
  caseEmbeddedOnly,
  reconciliation.warnings[1]
);
assert.equal(sparseEvidence.asset, "ETH");
assert.equal(sparseEvidence.quantity, 0.05);
assert.equal(sparseEvidence.direction, "OUT");
assert.equal(sparseEvidence.txHash, null);
assert.equal(sparseEvidence.date, null);
assert.equal(sparseEvidence.to, null);
assert.equal(sparseEvidence.from, "0xwallet");

// Without walletAnalyses, case path must not fabricate inventory fields.
const bareCase = {
  allRows: [],
  reconciliation: {
    transferChecks: [],
    warnings: reconciliation.warnings,
    unmatchedDeposits: [],
  },
};
const bareEvidence = buildCaseTransactionEvidence(bareCase, reconciliation.warnings[0]);
assert.equal(bareEvidence.asset, null);
assert.equal(bareEvidence.txHash, null);
assert.equal(bareEvidence.date, null);

// Dashboard and case-detail paths must agree when given the same inputs.
const dashboardEvidence = buildTransactionEvidence(reconciliation.warnings[0], {
  reconciliation,
  allRows: [],
  walletAnalyses,
});
assert.deepEqual(
  {
    asset: fullEvidence.asset,
    quantity: fullEvidence.quantity,
    date: fullEvidence.date,
    txHash: fullEvidence.txHash,
    direction: fullEvidence.direction,
    from: fullEvidence.from,
    to: fullEvidence.to,
  },
  {
    asset: dashboardEvidence.asset,
    quantity: dashboardEvidence.quantity,
    date: dashboardEvidence.date,
    txHash: dashboardEvidence.txHash,
    direction: dashboardEvidence.direction,
    from: dashboardEvidence.from,
    to: dashboardEvidence.to,
  }
);

assert.equal(caseFromApi.insights.confidenceIsHeuristic, true);
assert.match(caseFromApi.insights.confidenceLimitations, /not a statistically validated/i);

console.log("PASS: case-detail evidence receives and uses walletAnalyses (including null fields)");
