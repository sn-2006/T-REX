import assert from "node:assert/strict";
import { reconcile, withWalletReconciliationFlags } from "../src/utils/reconcile.js";
import {
  buildComplianceInsights,
  buildTransactionEvidence,
  computeEvidenceBasedConfidence,
} from "../src/utils/evidenceBuilder.js";
import { generateNarrativeReport } from "../src/utils/aiReport.js";
import { determineConsideration } from "../server/src/compliance/consideration.js";

// Estimated INR must stay estimated — never rewritten as verified settlement.
const estimated = determineConsideration({
  type: "SELL",
  asset: "ETH",
  amount: 1,
  receivedAsset: "USDC",
  receivedAmount: 500,
  receivedAssetFmvInrPerUnit: 84.2,
  inrValue: 42100,
  estimatedInrValue: 42100,
  actualInrReceived: null,
  valuationStatus: "ESTIMATED_INR",
});
assert.equal(estimated.valuationStatus, "ESTIMATED_INR");
assert.equal(estimated.actualInrReceived, null);
assert.equal(estimated.estimatedInrValue, 42100);
assert.equal(estimated.determined, false);

const verified = determineConsideration({
  type: "SELL",
  asset: "ETH",
  amount: 1,
  receivedAsset: "USDC",
  receivedAmount: 500,
  receivedAssetFmvInrPerUnit: 84,
  inrValue: 42000,
  actualInrReceived: 42000,
  valuationStatus: "VERIFIED_INR",
});
assert.equal(verified.valuationStatus, "VERIFIED_INR");
assert.equal(verified.determined, true);
assert.equal(verified.actualInrReceived, 42000);

const pendingAnalysis = {
  transferCount: 5,
  chain: { name: "Ethereum" },
  reconciliation: {
    transactionCount: 5,
    incomingCount: 3,
    outgoingCount: 2,
    manualVerificationCount: 3,
    tdsStatus: "NOT_DETERMINED",
  },
  traceability: {
    rawTransferCount: 5,
    pendingReviewCount: 3,
    accountedTransferCount: 2,
    verifiedRecordCount: 0,
    estimatedValueRecordCount: 2,
    unmatchedTransferCount: 0,
    transferOutcomes: [
      {
        refId: "leg-a",
        type: "DEX_SWAP_LEG",
        status: "RECONSTRUCTED_DEX_LEG",
        accountedFor: true,
        fullyVerified: false,
        valuationStatus: "ESTIMATED_INR",
      },
      {
        refId: "leg-b",
        type: "DEX_SWAP_LEG",
        status: "RECONSTRUCTED_DEX_LEG",
        accountedFor: true,
        fullyVerified: false,
        valuationStatus: "ESTIMATED_INR",
      },
      {
        refId: "pending-1",
        type: "MANUAL_REVIEW",
        status: "PENDING_MANUAL_REVIEW",
        accountedFor: false,
        fullyVerified: false,
        reason: "ownership unknown",
        evidenceSources: ["Alchemy asset transfer"],
      },
      {
        refId: "pending-2",
        type: "MANUAL_REVIEW",
        status: "PENDING_MANUAL_REVIEW",
        accountedFor: false,
        fullyVerified: false,
        reason: "ownership unknown",
      },
      {
        refId: "pending-3",
        type: "MANUAL_REVIEW",
        status: "PENDING_MANUAL_REVIEW",
        accountedFor: false,
        fullyVerified: false,
        reason: "ownership unknown",
      },
    ],
    inventory: [
      {
        rawTransferId: "pending-1",
        txHash: "0xabc123",
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
        rawTransferId: "pending-2",
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
};

const base = reconcile([]);
const merged = withWalletReconciliationFlags(base, [pendingAnalysis]);
assert.equal(merged.walletPendingReviewCount, 3);
assert.equal(merged.hasUnresolvedItems, true);
assert.equal(merged.warnings.filter((w) => w.type === "PENDING_MANUAL_REVIEW").length, 3);

// 1) Enriched pending-review evidence — available fields filled, missing stay null.
const pendingWarning = merged.warnings.find((w) => w.refId === "pending-1");
assert.equal(pendingWarning.asset, "DAI");
assert.equal(pendingWarning.txHash, "0xabc123");
assert.equal(pendingWarning.direction, "IN");
assert.equal(pendingWarning.from, "0xrouter");
assert.equal(pendingWarning.to, "0xwallet");

const enrichedEvidence = buildTransactionEvidence(pendingWarning, {
  reconciliation: merged,
  allRows: [],
  walletAnalyses: [pendingAnalysis],
});
assert.equal(enrichedEvidence.status, "PENDING_MANUAL_REVIEW");
assert.equal(enrichedEvidence.asset, "DAI");
assert.equal(enrichedEvidence.quantity, 10);
assert.equal(enrichedEvidence.date, "2026-08-20T12:00:00.000Z");
assert.equal(enrichedEvidence.txHash, "0xabc123");
assert.equal(enrichedEvidence.direction, "IN");
assert.equal(enrichedEvidence.from, "0xrouter");
assert.equal(enrichedEvidence.to, "0xwallet");
assert.equal(enrichedEvidence.sourceExchange, null);
assert.equal(enrichedEvidence.destinationExchange, null);

const sparseEvidence = buildTransactionEvidence(
  merged.warnings.find((w) => w.refId === "pending-2"),
  { reconciliation: merged, allRows: [], walletAnalyses: [pendingAnalysis] }
);
assert.equal(sparseEvidence.asset, "ETH");
assert.equal(sparseEvidence.txHash, null);
assert.equal(sparseEvidence.date, null);
assert.equal(sparseEvidence.to, null);

// 2) Evidence-based confidence — proportional unresolved drag, not a flat ≤55% ceiling.
const insights = buildComplianceInsights({
  allRows: [],
  reconciliation: merged,
  discrepancies: [],
  walletAnalyses: [pendingAnalysis],
});
assert.equal(insights.reviewRequiredCount, 3);
assert.equal(insights.walletPendingReviewCount, 3);
assert.equal(insights.confidenceMethod, "heuristic_evidence_completeness");
assert.match(insights.confidenceLimitations, /not a statistically validated/i);
assert.equal(insights.confidenceIsHeuristic, true);
assert.ok(insights.overallConfidence < 40);

const mostlyClean = computeEvidenceBasedConfidence({
  avgTransferConfidence: 95,
  tdsCoveragePct: 100,
  valuationCompletenessPct: 100,
  totalTransactions: 100,
  reviewRequiredCount: 1,
  unmatchedTransactions: 0,
  unresolvedValuationCount: 0,
  openWarningCount: 1,
});
// One unresolved item among 100 should remain high — not hard-capped at 55.
assert.ok(mostlyClean.overallConfidence > 55);
assert.ok(mostlyClean.overallConfidence < 100);

const fullyOpen = computeEvidenceBasedConfidence({
  avgTransferConfidence: 90,
  totalTransactions: 10,
  reviewRequiredCount: 10,
  openWarningCount: 10,
});
assert.ok(fullyOpen.overallConfidence < 30);

// 3) Wallet-only narrative uses the same pending/warnings/actions reporting path.
const walletOnlyNarrative = generateNarrativeReport({
  ...merged,
  mode: "DECENTRALIZED_WALLET",
  walletAnalyses: [pendingAnalysis],
  walletTransferCount: 5,
  walletReconciliation: [pendingAnalysis.reconciliation],
});
assert.match(walletOnlyNarrative, /DECENTRALIZED WALLET ANALYSIS/);
assert.match(walletOnlyNarrative, /3 on-chain transfer/);
assert.match(walletOnlyNarrative, /RECOMMENDED ACTIONS/);
assert.match(walletOnlyNarrative, /Complete manual review for 3/);
assert.match(walletOnlyNarrative, /pending-1/);
assert.doesNotMatch(walletOnlyNarrative, /No immediate manual actions are required/);

const narrative = generateNarrativeReport(merged);
assert.match(narrative, /3 on-chain transfer/);
assert.doesNotMatch(narrative, /No immediate manual actions are required/);

assert.notEqual(
  pendingAnalysis.traceability.accountedTransferCount,
  pendingAnalysis.traceability.verifiedRecordCount
);

console.log("PASS: enriched evidence, heuristic confidence, and wallet-only narrative consistency");
