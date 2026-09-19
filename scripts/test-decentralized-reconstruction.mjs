import assert from "node:assert/strict";
import { Interface } from "ethers";

process.env.ALCHEMY_ETH_RPC_URL = "https://mock.invalid";
delete process.env.METASLEUTH_ADDRESS_LABEL_API_KEY;
delete process.env.METASLEUTH_RISK_SCORE_API_KEY;

const wallet = "0x1111111111111111111111111111111111111111";
const router = "0x7a250d5630b4cf539739df2c5dacab4c659f2488";
const pairAddress = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc";
const hash = `0x${"ab".repeat(32)}`;
const unrelatedHash = `0x${"cd".repeat(32)}`;
const timestamp = "2026-08-20T12:00:00.000Z";
const originalFetch = global.fetch;

// Pre-encode V2 Swap + Sync events for realistic receipt logs.
const v2 = new Interface([
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
]);
const v2SwapEncoded = v2.encodeEventLog(v2.getEvent("Swap"), [
  router, // sender
  100000000000000000n, // amount0In: 0.1 ETH
  0n, // amount1In
  0n, // amount0Out
  500000000n, // amount1Out: 500 USDC (6 decimals)
  wallet, // to
]);
const v2SyncEncoded = v2.encodeEventLog(v2.getEvent("Sync"), [
  4500000000000000000000n, // reserve0
  11250000000000n, // reserve1
]);

global.fetch = async (url, options = {}) => {
  if (String(url).startsWith("https://mock.invalid")) {
    const body = JSON.parse(options.body || "{}");

    if (body.method === "alchemy_getAssetTransfers") {
      const params = body.params[0];
      const transfers = params.toAddress
        ? [{
            hash,
            uniqueId: "in",
            from: router,
            to: wallet,
            asset: "USDC",
            value: 500,
            rawContract: { address: "0x0000000000000000000000000000000000000001", decimals: 6 },
            category: "erc20",
            blockNum: "0x123",
            metadata: { blockTimestamp: timestamp },
          }, {
            hash: unrelatedHash,
            uniqueId: "unrelated-in",
            from: router,
            to: wallet,
            asset: "DAI",
            value: 10,
            rawContract: { address: "0x0000000000000000000000000000000000000002", decimals: 18 },
            category: "erc20",
            blockNum: "0x124",
            metadata: { blockTimestamp: timestamp },
          }]
        : [{
            hash,
            uniqueId: "out",
            from: wallet,
            to: router,
            asset: "ETH",
            value: 0.1,
            category: "external",
            blockNum: "0x123",
            metadata: { blockTimestamp: timestamp },
          }];

      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { transfers } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (body.method === "eth_getTransactionByHash") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          hash,
          to: router,
          input: `0x7ff36ab5${"00".repeat(100)}`,
          gasPrice: "0x3b9aca00",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (body.method === "eth_getTransactionReceipt") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          status: "0x1",
          gasUsed: "0x5208",
          logs: [
            {
              address: pairAddress,
              topics: v2SwapEncoded.topics,
              data: v2SwapEncoded.data,
              transactionHash: hash,
              logIndex: "0x1",
            },
            {
              address: pairAddress,
              topics: v2SyncEncoded.topics,
              data: v2SyncEncoded.data,
              transactionHash: hash,
              logIndex: "0x2",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }

  if (String(url).startsWith("https://api.frankfurter.app/")) {
    return new Response(JSON.stringify({ rates: { INR: 84.2 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return originalFetch(url, options);
};

const { analyzeEthereumWallet } = await import("../server/src/services/walletTracing.js");
const { analyzeRows } = await import("../server/src/compliance/tds.js");
const { reconcile, withWalletReconciliationFlags } = await import("../src/utils/reconcile.js");
const { buildComplianceInsights } = await import("../src/utils/evidenceBuilder.js");
const { generateNarrativeReport } = await import("../src/utils/aiReport.js");

const analysis = await analyzeEthereumWallet(wallet);
assert.equal(analysis.transferCount, 3);
assert.equal(analysis.derivedDexEventCount, 1);
assert.equal(analysis.derivedTransactions.length, 1);
assert.equal(analysis.traceability.rawTransferCount, 3);
assert.equal(analysis.traceability.classifiedTransferCount, 3);
assert.equal(analysis.traceability.reconstructedEventCount, 1);
assert.equal(analysis.traceability.complianceRowCount, 1);
assert.equal(analysis.traceability.excludedTransferCount, 0);
assert.equal(analysis.traceability.outcomeCounts.DEX_SWAP_LEG, 2);
assert.equal(analysis.traceability.outcomeCounts.MANUAL_REVIEW, 1);
assert.equal(analysis.traceability.pendingReviewCount, 1);
// Pending review is classified but not accounted; only DEX legs are accounted.
assert.equal(analysis.traceability.accountedTransferCount, 2);
assert.equal(analysis.traceability.verifiedRecordCount, 0);
assert.equal(analysis.traceability.estimatedValueRecordCount, 2);
assert.equal(analysis.traceability.unmatchedTransferCount, 0);
assert.equal(analysis.traceability.inventory.length, 3);
assert.equal(analysis.traceability.inventory.filter((item) => item.accountedFor).length, 2);
assert.equal(analysis.traceability.inventory.filter((item) => item.fullyVerified).length, 0);
assert.equal(
  analysis.traceability.inventory.filter((item) => item.status === "PENDING_MANUAL_REVIEW").length,
  1
);
assert.equal(analysis.traceability.inventory.filter((item) => item.linkedEconomicEventId).length, 2);
assert.equal(analysis.traceability.inventory[0].gasFeeWei, "21000000000000");
assert.equal(analysis.derivedTransactions[0].reconstruction.sourceTransferRefs.length, 2);

const event = analysis.derivedTransactions[0];
assert.equal(event.type, "SELL");
assert.equal(event.asset, "ETH");
assert.equal(event.receivedAsset, "USDC");
assert.equal(event.receivedAmount, 500);
assert.equal(event.transactionSource, "DECENTRALIZED_DEX");
assert.equal(event.transactionClassification.transferType, "VDA_TO_VDA");
assert.equal(event.valuationStatus, "ESTIMATED_INR");
assert.equal(event.inrValue, 42100);
assert.equal(event.actualInrReceived, null);
assert.ok(event.receivedAssetFmvInrPerUnit != null);

const compliance = analyzeRows([event]);
assert.equal(compliance.summary.confirmedVdaTransfers, 1);
assert.equal(compliance.summary.expectedTds, 421);
assert.equal(compliance.discrepancies.length, 0);
assert.equal(compliance.tdsRows[0].reportedTds, null);
assert.equal(compliance.rows[0].consideration.valuationStatus, "ESTIMATED_INR");
assert.equal(compliance.rows[0].consideration.actualInrReceived, null);
assert.equal(compliance.rows[0].consideration.estimatedInrValue, 42100);

const exchangeReconciliation = reconcile(compliance.rows);
assert.equal(
  exchangeReconciliation.warnings.some((w) => w.type === "VALUATION_ESTIMATED"),
  true
);

const merged = withWalletReconciliationFlags(exchangeReconciliation, [analysis]);
assert.equal(merged.walletPendingReviewCount, 1);
assert.equal(merged.hasUnresolvedItems, true);
assert.equal(
  merged.warnings.filter((w) => w.type === "PENDING_MANUAL_REVIEW").length,
  1
);
// One compliance event for the DEX swap — raw legs are not duplicated as compliance rows.
assert.equal(analysis.traceability.complianceRowCount, 1);

const insights = buildComplianceInsights({
  allRows: compliance.rows,
  reconciliation: merged,
  discrepancies: [],
  walletAnalyses: [analysis],
});
assert.ok(insights.reviewRequiredCount >= 1);
assert.equal(insights.confidenceMethod, "heuristic_evidence_completeness");
assert.equal(insights.confidenceIsHeuristic, true);
assert.ok(insights.overallConfidence < 70);
assert.equal(insights.walletPendingReviewCount, 1);

const narrative = generateNarrativeReport(merged);
assert.match(narrative, /pending manual review/i);
assert.doesNotMatch(narrative, /No immediate manual actions are required/);

console.log("PASS: decentralized DEX reconstruction + consideration + TDS integration");
console.log(`Derived DEX events: ${analysis.derivedDexEventCount}`);
console.log(`Consideration: ₹${event.inrValue} (${event.valuationStatus})`);
console.log(`Expected TDS: ₹${compliance.summary.expectedTds}`);
console.log(`Pending review: ${analysis.traceability.pendingReviewCount}; accounted: ${analysis.traceability.accountedTransferCount}; verified: ${analysis.traceability.verifiedRecordCount}`);
