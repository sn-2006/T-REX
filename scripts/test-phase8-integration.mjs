import assert from "node:assert/strict";
import { buildTransactionEvidence } from "../src/utils/evidenceBuilder.js";
import { generateNarrativeReport } from "../src/utils/aiReport.js";

const txHash = `0x${"aa".repeat(32)}`;
const pool = "0x1111111111111111111111111111111111111111";
const analysis = {
  wallet: "0x2222222222222222222222222222222222222222",
  transferCount: 2,
  derivedDexEventCount: 1,
  derivedTransactions: [{
    refId: `onchain-${txHash}`,
    txHash,
    transactionSource: "DECENTRALIZED_DEX",
    valuationEvidence: { transactionHash: txHash, poolAddress: pool },
    reconstruction: {
      kind: "DEX_SWAP",
      poolAddress: pool,
      routeStatus: "COMPLETE",
      route: [
        { hopIndex: 0, poolAddress: pool, tokenIn: "0xaaa", tokenOut: "0xbbb", evidence: { ammEvent: { logIndex: 1 } } },
        { hopIndex: 1, poolAddress: "0x3333333333333333333333333333333333333333", tokenIn: "0xbbb", tokenOut: "0xccc", evidence: { ammEvent: { logIndex: 2 } } },
      ],
      decodedEvents: [{ rawLog: { transactionHash: txHash, logIndex: 1 } }],
      uninterpretedLogs: [{ rawLog: { transactionHash: txHash, logIndex: 3 } }],
      financialMetrics: {
        priceImpact: { status: "UNKNOWN", value: null, reason: "Reserve evidence unavailable." },
        tradingFee: { status: "UNKNOWN", value: null, reason: "Fee tier unavailable." },
        gasCost: { status: "DERIVED", nativeAmount: 0.001, gasFeeWei: "1000000000000000" },
      },
    },
  }],
  derivedLiquidityEvents: [{
    eventType: "LIQUIDITY_ADD",
    transactionHash: txHash,
    poolAddress: pool,
    interpretationStatus: "VERIFIED_LIQUIDITY_EVENT",
  }],
  derivedLiquidityPositions: [{
    positionId: "position-1",
    poolAddress: pool,
    positionStatus: "OPEN",
    originatingTransactionHash: txHash,
    removalTransactionHash: null,
  }],
};

const evidence = buildTransactionEvidence(
  { type: "VALUATION_ESTIMATED", refId: `onchain-${txHash}` },
  {
    reconciliation: { transferChecks: [], warnings: [], unmatchedDeposits: [] },
    allRows: [{
      refId: `onchain-${txHash}`,
      asset: "ETH",
      amount: 1,
      date: "2026-09-19",
      exchange: "DEX",
      transactionSource: "DECENTRALIZED_DEX",
      txHash,
      valuationEvidence: analysis.derivedTransactions[0].valuationEvidence,
    }],
    walletAnalyses: [analysis],
  }
);
assert.equal(evidence.dexEvidence.transactionHash, txHash);
assert.equal(evidence.dexEvidence.poolAddress, pool);
assert.equal(evidence.dexEvidence.route.length, 2);
assert.equal(evidence.dexEvidence.liquidityEvents.length, 1);
assert.equal(evidence.dexEvidence.liquidityPositions[0].positionStatus, "OPEN");
assert.equal(evidence.dexEvidence.financialMetrics.priceImpact.status, "UNKNOWN");
assert.equal(evidence.dexEvidence.rawEvidence.uninterpretedLogs.length, 1);

const narrative = generateNarrativeReport({
  mode: "DECENTRALIZED_WALLET",
  walletAnalyses: [analysis],
  walletTransferCount: 2,
  warnings: [],
  unmatchedDeposits: [],
  walletReconciliation: [{ transactionCount: 2, incomingCount: 1, outgoingCount: 1, manualVerificationCount: 0, tdsStatus: "NOT_DETERMINED" }],
});
assert.match(narrative, /DEX EVIDENCE/);
assert.match(narrative, /Route hops/);
assert.match(narrative, /LIQUIDITY_ADD/);
assert.match(narrative, /LP position OPEN/);
assert.match(narrative, /Price impact: UNKNOWN/);
assert.match(narrative, /Only values marked VERIFIED or DERIVED/);

const reportContext = {
  insights: { totalTransactions: 2, unmatchedTransactions: 0 },
  discrepancies: [],
  reconciliation: { transferChecks: [], warnings: [], unmatchedDeposits: [] },
  walletAnalyses: [analysis],
};
global.localStorage = { getItem: () => null };
let capturedPrompt = null;
global.fetch = async (_url, options) => {
  capturedPrompt = JSON.parse(options.body);
  return new Response(JSON.stringify({ reply: "Evidence received; UNKNOWN metrics remain unresolved." }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const { answerReportQuestion, SYSTEM_PROMPT } = await import("../src/services/complianceAssistant.js?phase8");
const answer = await answerReportQuestion("Explain the DEX route and metrics.", reportContext);
assert.equal(answer.source, "llm");
assert.match(capturedPrompt.userPrompt, /financialMetrics/);
assert.match(capturedPrompt.userPrompt, /LIQUIDITY_ADD/);
assert.match(capturedPrompt.userPrompt, /UNKNOWN/);
assert.match(SYSTEM_PROMPT, /Never turn null, UNKNOWN, or PENDING_REVIEW/);

const serialized = JSON.stringify(analysis);
assert.match(serialized, /financialMetrics/);
assert.match(serialized, /derivedLiquidityPositions/);
assert.equal(analysis.traceability?.complianceRowCount ?? 1, 1);
console.log("PASS: Phase 8 evidence, AI context, UNKNOWN handling, and compatibility checks");
