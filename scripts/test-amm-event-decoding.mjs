import assert from "node:assert/strict";
import { Interface } from "ethers";
import {
  decodeAmmLog,
  decodeReceiptAmmEvents,
  detectLiquidityActivities,
  trackLiquidityPositions,
  reconstructAmmRoute,
  computeEvidenceConfidence,
} from "../server/src/services/dexEventDecoder.js";
import { computeAmmFinancialMetrics } from "../server/src/services/ammFinancialMetrics.js";

const v2 = new Interface([
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
]);

const v3 = new Interface([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);

const erc20 = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

const pairAddress = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc";
const poolV3Address = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";
const txHash = `0x${"11".repeat(32)}`;

// ---------------------------------------------------------------------------
// 1. Uniswap V2 Swap Event Decoding
// ---------------------------------------------------------------------------
const v2SwapEncoded = v2.encodeEventLog(v2.getEvent("Swap"), [
  "0x7a250d5630b4cf539739df2c5dacab4c659f2488",
  1000000000000000000n, // amount0In: 1 ETH
  0n, // amount1In
  0n, // amount0Out
  2500000000n, // amount1Out: 2500 USDC
  "0x3333333333333333333333333333333333333333",
]);

const v2SwapLog = {
  address: pairAddress,
  topics: v2SwapEncoded.topics,
  data: v2SwapEncoded.data,
  transactionHash: txHash,
  logIndex: "0x3",
};

const decodedV2Swap = decodeAmmLog(v2SwapLog);
assert.ok(decodedV2Swap, "Uniswap V2 Swap should be decoded");
assert.equal(decodedV2Swap.protocol, "Uniswap_V2");
assert.equal(decodedV2Swap.eventType, "Swap");
assert.equal(decodedV2Swap.poolAddress, pairAddress.toLowerCase());
assert.equal(decodedV2Swap.sender, "0x7a250d5630b4cf539739df2c5dacab4c659f2488".toLowerCase());
assert.equal(decodedV2Swap.to, "0x3333333333333333333333333333333333333333".toLowerCase());
assert.equal(decodedV2Swap.tokenAmounts.amount0In, "1000000000000000000");
assert.equal(decodedV2Swap.tokenAmounts.amount1In, "0");
assert.equal(decodedV2Swap.tokenAmounts.amount0Out, "0");
assert.equal(decodedV2Swap.tokenAmounts.amount1Out, "2500000000");
assert.equal(decodedV2Swap.txHash, txHash);
assert.equal(decodedV2Swap.logIndex, 3);
assert.deepEqual(decodedV2Swap.rawLog, {
  address: pairAddress,
  topics: v2SwapLog.topics,
  data: v2SwapLog.data,
  logIndex: "0x3",
  transactionHash: txHash,
});
console.log("PASS: 1. Valid Uniswap V2 Swap decoded successfully");

// ---------------------------------------------------------------------------
// 2. Uniswap V2 Sync Event Decoding
// ---------------------------------------------------------------------------
const v2SyncEncoded = v2.encodeEventLog(v2.getEvent("Sync"), [
  4500000000000000000000n, // reserve0
  11250000000000n, // reserve1
]);

const v2SyncLog = {
  address: pairAddress,
  topics: v2SyncEncoded.topics,
  data: v2SyncEncoded.data,
  transactionHash: txHash,
  logIndex: 4,
};

const decodedV2Sync = decodeAmmLog(v2SyncLog);
assert.ok(decodedV2Sync, "Uniswap V2 Sync should be decoded");
assert.equal(decodedV2Sync.protocol, "Uniswap_V2");
assert.equal(decodedV2Sync.eventType, "Sync");
assert.equal(decodedV2Sync.poolAddress, pairAddress.toLowerCase());
assert.equal(decodedV2Sync.reserveChanges.reserve0, "4500000000000000000000");
assert.equal(decodedV2Sync.reserveChanges.reserve1, "11250000000000");
assert.equal(decodedV2Sync.txHash, txHash);
assert.equal(decodedV2Sync.logIndex, 4);
console.log("PASS: 2. Valid Uniswap V2 Sync decoded successfully");

// ---------------------------------------------------------------------------
// 3. Uniswap V3 Swap Event Decoding
// ---------------------------------------------------------------------------
const v3SwapEncoded = v3.encodeEventLog(v3.getEvent("Swap"), [
  "0xe592427a0aece92de3edee1f18e0157c05861564", // sender (Uniswap V3 router)
  "0x4444444444444444444444444444444444444444", // recipient
  -2000000000000000000n, // amount0: -2 ETH
  5000000000n, // amount1: 5000 USDC
  158456325028528675187087900672n, // sqrtPriceX96
  1234567890123456n, // liquidity
  -194200, // tick
]);

const v3SwapLog = {
  address: poolV3Address,
  topics: v3SwapEncoded.topics,
  data: v3SwapEncoded.data,
  transactionHash: txHash,
  logIndex: "0xa",
};

const decodedV3Swap = decodeAmmLog(v3SwapLog);
assert.ok(decodedV3Swap, "Uniswap V3 Swap should be decoded");
assert.equal(decodedV3Swap.protocol, "Uniswap_V3");
assert.equal(decodedV3Swap.eventType, "Swap");
assert.equal(decodedV3Swap.poolAddress, poolV3Address.toLowerCase());
assert.equal(decodedV3Swap.sender, "0xe592427a0aece92de3edee1f18e0157c05861564".toLowerCase());
assert.equal(decodedV3Swap.recipient, "0x4444444444444444444444444444444444444444".toLowerCase());
assert.equal(decodedV3Swap.tokenAmounts.amount0, "-2000000000000000000");
assert.equal(decodedV3Swap.tokenAmounts.amount1, "5000000000");
assert.equal(decodedV3Swap.sqrtPriceX96, "158456325028528675187087900672");
assert.equal(decodedV3Swap.liquidity, "1234567890123456");
assert.equal(decodedV3Swap.tick, -194200);
assert.equal(decodedV3Swap.txHash, txHash);
assert.equal(decodedV3Swap.logIndex, 10);
console.log("PASS: 3. Valid Uniswap V3 Swap decoded successfully");

// ---------------------------------------------------------------------------
// 4. Uniswap V2 Mint & Burn Decoding
// ---------------------------------------------------------------------------
const v2MintEncoded = v2.encodeEventLog(v2.getEvent("Mint"), [
  "0x5555555555555555555555555555555555555555",
  1000000000000000000n,
  2000000000n,
]);
const decodedMint = decodeAmmLog({
  address: pairAddress,
  topics: v2MintEncoded.topics,
  data: v2MintEncoded.data,
  transactionHash: txHash,
  logIndex: 1,
});
assert.equal(decodedMint.eventType, "Mint");
assert.equal(decodedMint.tokenAmounts.amount0, "1000000000000000000");
assert.equal(decodedMint.tokenAmounts.amount1, "2000000000");

const v2BurnEncoded = v2.encodeEventLog(v2.getEvent("Burn"), [
  "0x5555555555555555555555555555555555555555",
  500000000000000000n,
  1000000000n,
  "0x6666666666666666666666666666666666666666",
]);
const decodedBurn = decodeAmmLog({
  address: pairAddress,
  topics: v2BurnEncoded.topics,
  data: v2BurnEncoded.data,
  transactionHash: txHash,
  logIndex: 2,
});
assert.equal(decodedBurn.eventType, "Burn");
assert.equal(decodedBurn.tokenAmounts.amount0, "500000000000000000");
assert.equal(decodedBurn.tokenAmounts.amount1, "1000000000");
console.log("PASS: 4. Uniswap V2 Mint & Burn decoded successfully");

// ---------------------------------------------------------------------------
// 5. Receipt-verified liquidity addition/removal
// ---------------------------------------------------------------------------
const liquidityProvider = "0x7777777777777777777777777777777777777777";
const liquidityRecipient = "0x8888888888888888888888888888888888888888";
const liquidityToken0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const liquidityToken1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const mintEncoded = v2.encodeEventLog(v2.getEvent("Mint"), [liquidityProvider, 123n, 456n]);
const burnEncoded = v2.encodeEventLog(v2.getEvent("Burn"), [liquidityProvider, 12n, 34n, liquidityRecipient]);
const mintLog = {
  address: pairAddress,
  topics: mintEncoded.topics,
  data: mintEncoded.data,
  transactionHash: txHash,
  logIndex: 12,
};
const burnLog = {
  address: pairAddress,
  topics: burnEncoded.topics,
  data: burnEncoded.data,
  transactionHash: txHash,
  logIndex: 22,
};
const mintReceiptLogs = [
  transferLog(liquidityToken0, liquidityProvider, pairAddress, 123n, 10),
  transferLog(liquidityToken1, liquidityProvider, pairAddress, 456n, 11),
  mintLog,
];
const burnReceiptLogs = [
  transferLog(liquidityToken0, pairAddress, liquidityRecipient, 12n, 20),
  transferLog(liquidityToken1, pairAddress, liquidityRecipient, 34n, 21),
  burnLog,
];
const mintDecoded = decodeReceiptAmmEvents(mintReceiptLogs, txHash);
const burnDecoded = decodeReceiptAmmEvents(burnReceiptLogs, txHash);
const [liquidityAdd] = detectLiquidityActivities({ decodedEvents: mintDecoded.decodedEvents, logs: mintReceiptLogs });
const [liquidityRemove] = detectLiquidityActivities({ decodedEvents: burnDecoded.decodedEvents, logs: burnReceiptLogs });
assert.equal(liquidityAdd.eventType, "LIQUIDITY_ADD");
assert.equal(liquidityAdd.interpretationStatus, "VERIFIED_LIQUIDITY_EVENT");
assert.equal(liquidityAdd.poolAddress, pairAddress.toLowerCase());
assert.equal(liquidityAdd.providerAddress, liquidityProvider.toLowerCase());
assert.deepEqual(liquidityAdd.tokenAmounts, [
  { tokenAddress: liquidityToken0, amount: "123" },
  { tokenAddress: liquidityToken1, amount: "456" },
]);
assert.equal(liquidityAdd.transactionHash, txHash);
assert.equal(liquidityAdd.logIndex, 12);
assert.equal(liquidityAdd.rawEventEvidence.address, pairAddress);
assert.equal(liquidityAdd.transferEvidence.length, 2);

assert.equal(liquidityRemove.eventType, "LIQUIDITY_REMOVE");
assert.equal(liquidityRemove.interpretationStatus, "VERIFIED_LIQUIDITY_EVENT");
assert.equal(liquidityRemove.poolAddress, pairAddress.toLowerCase());
assert.equal(liquidityRemove.providerAddress, liquidityRecipient.toLowerCase());
assert.deepEqual(liquidityRemove.tokenAmounts, [
  { tokenAddress: liquidityToken0, amount: "12" },
  { tokenAddress: liquidityToken1, amount: "34" },
]);

const incompleteLiquidity = detectLiquidityActivities({
  decodedEvents: mintDecoded.decodedEvents,
  logs: [mintLog, mintReceiptLogs[0]],
})[0];
assert.equal(incompleteLiquidity.interpretationStatus, "INCOMPLETE_LIQUIDITY_EVENT");
assert.deepEqual(incompleteLiquidity.tokenAmounts, [
  { tokenAddress: null, amount: "123" },
  { tokenAddress: null, amount: "456" },
]);
assert.equal(incompleteLiquidity.transferEvidence.length, 1);
assert.equal(detectLiquidityActivities({ decodedEvents: [], logs: mintReceiptLogs }).length, 0);
console.log("PASS: 5. Mint/Burn liquidity activity requires matching pool transfer evidence");

// ---------------------------------------------------------------------------
// 6. LP position lifecycle tracking
// ---------------------------------------------------------------------------
function positionEvent(eventType, hash, logIndex, providerAddress, amounts, status = "VERIFIED_LIQUIDITY_EVENT") {
  const rawLog = { address: pairAddress, topics: [eventType], data: "0x", logIndex, transactionHash: hash };
  return {
    eventType,
    poolAddress: pairAddress,
    providerAddress,
    tokenAmounts: amounts,
    transactionHash: hash,
    txHash: hash,
    logIndex,
    rawEventEvidence: rawLog,
    transferEvidence: [],
    interpretationStatus: status,
  };
}

const positionProvider = liquidityProvider.toLowerCase();
const positionAdd = positionEvent("LIQUIDITY_ADD", `0x${"21".repeat(32)}`, 1, positionProvider, [
  { tokenAddress: liquidityToken0, amount: "100" },
  { tokenAddress: liquidityToken1, amount: "200" },
]);
const positionRemove = positionEvent("LIQUIDITY_REMOVE", `0x${"22".repeat(32)}`, 2, positionProvider, [
  { tokenAddress: liquidityToken0, amount: "100" },
  { tokenAddress: liquidityToken1, amount: "200" },
]);
const matchedPositions = trackLiquidityPositions([positionAdd, positionRemove]);
assert.equal(matchedPositions.length, 1);
assert.equal(matchedPositions[0].positionStatus, "CLOSED");
assert.equal(matchedPositions[0].originatingTransactionHash, positionAdd.transactionHash);
assert.equal(matchedPositions[0].removalTransactionHash, positionRemove.transactionHash);
assert.deepEqual(matchedPositions[0].tokenAmountsRemoved, positionRemove.tokenAmounts);
assert.equal(matchedPositions[0].supportingEvidence.removals.length, 1);

const secondAdd = positionEvent("LIQUIDITY_ADD", `0x${"23".repeat(32)}`, 3, positionProvider, [
  { tokenAddress: liquidityToken0, amount: "50" },
  { tokenAddress: liquidityToken1, amount: "100" },
]);
const secondRemove = positionEvent("LIQUIDITY_REMOVE", `0x${"24".repeat(32)}`, 4, positionProvider, [
  { tokenAddress: liquidityToken0, amount: "50" },
  { tokenAddress: liquidityToken1, amount: "100" },
]);
const multiplePositions = trackLiquidityPositions([positionAdd, secondAdd, secondRemove]);
assert.equal(multiplePositions.length, 2);
assert.equal(multiplePositions[0].positionStatus, "OPEN");
assert.equal(multiplePositions[1].positionStatus, "CLOSED");

const partialRemove = positionEvent("LIQUIDITY_REMOVE", `0x${"25".repeat(32)}`, 5, positionProvider, [
  { tokenAddress: liquidityToken0, amount: "40" },
  { tokenAddress: liquidityToken1, amount: "80" },
]);
const partialPosition = trackLiquidityPositions([positionAdd, partialRemove])[0];
assert.equal(partialPosition.positionStatus, "PARTIALLY_REMOVED");
assert.deepEqual(partialPosition.tokenAmountsRemoved, partialRemove.tokenAmounts);
assert.deepEqual(partialPosition.supportingEvidence.add.rawEventEvidence, positionAdd.rawEventEvidence);

const openPosition = trackLiquidityPositions([positionAdd])[0];
assert.equal(openPosition.positionStatus, "OPEN");
assert.equal(openPosition.removalTransactionHash, null);

const ambiguousAdd = positionEvent("LIQUIDITY_ADD", `0x${"26".repeat(32)}`, 6, null, positionAdd.tokenAmounts);
const ambiguousRemove = positionEvent("LIQUIDITY_REMOVE", `0x${"27".repeat(32)}`, 7, null, positionRemove.tokenAmounts);
const ambiguousPositions = trackLiquidityPositions([ambiguousAdd, ambiguousRemove]);
assert.equal(ambiguousPositions[0].positionStatus, "OPEN_UNOWNED");
assert.equal(ambiguousPositions[1].positionStatus, "UNMATCHED_REMOVAL");
assert.equal(ambiguousPositions[1].originatingTransactionHash, null);

const duplicateAdd = positionEvent("LIQUIDITY_ADD", `0x${"28".repeat(32)}`, 8, positionProvider, positionAdd.tokenAmounts);
const duplicateRemove = positionEvent("LIQUIDITY_REMOVE", `0x${"29".repeat(32)}`, 9, positionProvider, positionRemove.tokenAmounts);
const ambiguousMatch = trackLiquidityPositions([positionAdd, duplicateAdd, duplicateRemove]);
assert.equal(ambiguousMatch[2].positionStatus, "AMBIGUOUS_MATCH");
assert.equal(trackLiquidityPositions([{ eventType: "Swap", poolAddress: pairAddress }]).length, 0);
console.log("PASS: 6. LP positions match conservatively and preserve unmatched evidence");

// ---------------------------------------------------------------------------
// 7. Unrelated logs preserved as uninterpreted
// ---------------------------------------------------------------------------
const transferEncoded = erc20.encodeEventLog(erc20.getEvent("Transfer"), [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  1000000n,
]);
const unrelatedLog = {
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  topics: transferEncoded.topics,
  data: transferEncoded.data,
  transactionHash: txHash,
};
const unrelatedResult = decodeAmmLog(unrelatedLog);
assert.equal(unrelatedResult.interpretation, "UNINTERPRETED_EVENT_SIGNATURE");
assert.equal(unrelatedResult.eventType, "UNKNOWN");
assert.equal(unrelatedResult.protocol, null);
assert.deepEqual(unrelatedResult.rawLog, {
  address: unrelatedLog.address,
  topics: unrelatedLog.topics,
  data: unrelatedLog.data,
  logIndex: null,
  transactionHash: txHash,
});
assert.equal(unrelatedResult.rawLog.address, unrelatedLog.address);
assert.equal(unrelatedResult.rawLog.transactionHash, txHash);

const receiptLogs = [unrelatedLog, v2SwapLog, v2SyncLog];
const batchDecoded = decodeReceiptAmmEvents(receiptLogs, txHash);
assert.equal(batchDecoded.decodedEvents.length, 2);
assert.equal(batchDecoded.decodedEvents[0].eventType, "Swap");
assert.equal(batchDecoded.decodedEvents[1].eventType, "Sync");
assert.equal(batchDecoded.uninterpretedLogs.length, 1);
assert.equal(batchDecoded.hasAmmSwap, true);
assert.equal(batchDecoded.primaryPoolAddress, pairAddress.toLowerCase());
assert.equal(batchDecoded.allPoolAddresses.length, 1);
console.log("PASS: 5. Unrelated logs preserved as uninterpreted; AMM events decoded correctly");

// ---------------------------------------------------------------------------
// 6. Malformed/unknown logs not crashing analysis
// ---------------------------------------------------------------------------
assert.equal(decodeAmmLog(null), null);
assert.equal(decodeAmmLog({}), null);
assert.equal(decodeAmmLog({ topics: [] }), null);
// Unknown topic with data
const unknownTopicResult = decodeAmmLog({ topics: ["0x1234"], data: "invalid" });
assert.equal(unknownTopicResult.interpretation, "UNINTERPRETED_EVENT_SIGNATURE");
// Truncated Swap data → MALFORMED_LOG_DATA
const malformedResult = decodeAmmLog({ topics: v2SwapEncoded.topics, data: "0x1234" });
assert.equal(malformedResult.interpretation, "MALFORMED_LOG_DATA");
assert.ok(malformedResult.rawLog, "Raw log should be preserved for malformed entries");
assert.equal(malformedResult.rawLog.address, null);
assert.deepEqual(malformedResult.rawLog.topics, v2SwapEncoded.topics);
assert.equal(malformedResult.rawLog.data, "0x1234");
// Null/undefined list
const nullBatch = decodeReceiptAmmEvents(null);
assert.deepEqual(nullBatch.decodedEvents, []);
assert.deepEqual(nullBatch.uninterpretedLogs, []);
assert.equal(nullBatch.hasAmmSwap, false);
const mixedBatch = decodeReceiptAmmEvents([null, {}, { topics: [v2SwapEncoded.topics[0]], data: "0x00" }]);
assert.deepEqual(mixedBatch.decodedEvents, []);
assert.equal(mixedBatch.hasAmmSwap, false, "Unknown signatures must not become swaps");
console.log("PASS: 6. Malformed logs handled safely without crashing");

// ---------------------------------------------------------------------------
// 7. Evidence-driven multi-hop route reconstruction
// ---------------------------------------------------------------------------
const tokenA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const tokenC = "0xcccccccccccccccccccccccccccccccccccccccc";
const tokenD = "0xdddddddddddddddddddddddddddddddddddddddd";
const poolOne = "0x1111111111111111111111111111111111111111";
const poolTwo = "0x2222222222222222222222222222222222222222";
const poolThree = "0x3333333333333333333333333333333333333333";
const routeSender = "0x9999999999999999999999999999999999999999";

function transferLog(tokenAddress, from, to, amount, logIndex) {
  const encoded = erc20.encodeEventLog(erc20.getEvent("Transfer"), [from, to, amount]);
  return { address: tokenAddress, topics: encoded.topics, data: encoded.data, transactionHash: txHash, logIndex };
}

function swapLog(poolAddress, logIndex) {
  const encoded = v2.encodeEventLog(v2.getEvent("Swap"), [routeSender, 10n, 0n, 0n, 9n, routeSender]);
  return { address: poolAddress, topics: encoded.topics, data: encoded.data, transactionHash: txHash, logIndex };
}

const twoHopLogs = [
  transferLog(tokenA, routeSender, poolOne, 10n, 1),
  transferLog(tokenB, poolOne, routeSender, 9n, 2),
  swapLog(poolOne, 3),
  transferLog(tokenB, routeSender, poolTwo, 9n, 4),
  transferLog(tokenC, poolTwo, routeSender, 8n, 5),
  swapLog(poolTwo, 6),
  { address: tokenD, topics: ["0x1234"], data: "0x", transactionHash: txHash, logIndex: 7 },
];
const twoHopDecoded = decodeReceiptAmmEvents(twoHopLogs, txHash);
const twoHopRoute = reconstructAmmRoute({ decodedEvents: twoHopDecoded.decodedEvents, logs: twoHopLogs });
assert.equal(twoHopRoute.routeStatus, "COMPLETE");
assert.deepEqual(twoHopRoute.route.map((hop) => hop.hopIndex), [0, 1]);
assert.deepEqual(twoHopRoute.route.map((hop) => hop.poolAddress), [poolOne, poolTwo]);
assert.deepEqual(twoHopRoute.route.map((hop) => hop.tokenIn), [tokenA, tokenB]);
assert.deepEqual(twoHopRoute.route.map((hop) => hop.tokenOut), [tokenB, tokenC]);
assert.deepEqual(twoHopRoute.logicalInput, { token: tokenA, amount: "10" });
assert.deepEqual(twoHopRoute.logicalOutput, { token: tokenC, amount: "8" });
assert.equal(twoHopRoute.route[0].evidence.ammEvent.address, poolOne);
assert.equal(twoHopRoute.route[1].evidence.transferLogs.length, 2);

const threeHopLogs = [
  transferLog(tokenA, routeSender, poolOne, 10n, 1), transferLog(tokenB, poolOne, routeSender, 9n, 2), swapLog(poolOne, 3),
  transferLog(tokenB, routeSender, poolTwo, 9n, 4), transferLog(tokenC, poolTwo, routeSender, 8n, 5), swapLog(poolTwo, 6),
  transferLog(tokenC, routeSender, poolThree, 8n, 7), transferLog(tokenD, poolThree, routeSender, 7n, 8), swapLog(poolThree, 9),
];
const threeHopDecoded = decodeReceiptAmmEvents(threeHopLogs, txHash);
const threeHopRoute = reconstructAmmRoute({ decodedEvents: threeHopDecoded.decodedEvents, logs: threeHopLogs });
assert.equal(threeHopRoute.routeStatus, "COMPLETE");
assert.deepEqual(threeHopRoute.route.map((hop) => hop.hopIndex), [0, 1, 2]);
assert.deepEqual(threeHopRoute.route.map((hop) => hop.tokenOut), [tokenB, tokenC, tokenD]);
assert.deepEqual(threeHopRoute.logicalOutput, { token: tokenD, amount: "7" });

const incompleteRoute = reconstructAmmRoute({
  decodedEvents: twoHopDecoded.decodedEvents,
  logs: twoHopLogs.filter((log) => log.address !== tokenB),
});
assert.equal(incompleteRoute.routeStatus, "INCOMPLETE");
assert.equal(incompleteRoute.route[0].tokenIn, null);
assert.equal(incompleteRoute.logicalInput, null);
assert.equal(incompleteRoute.logicalOutput, null);
assert.equal(twoHopDecoded.decodedEvents.length, 2, "Unrelated events must not become route hops");
console.log("PASS: 7. Ordered two-hop and three-hop routes reconstruct only from provable evidence");

// ---------------------------------------------------------------------------
// 8. Evidence-backed AMM financial metrics
// ---------------------------------------------------------------------------
const singleHopMetrics = computeAmmFinancialMetrics({
  decodedEvents: [decodedV2Swap, decodedV2Sync],
  route: [{ hopIndex: 0, poolAddress: pairAddress, evidence: { ammEvent: v2SwapLog } }],
  gasEvidence: {
    transactionHash: txHash,
    gasUsed: "21000",
    gasPrice: "1000000000",
    gasFeeWei: "21000000000000",
    gasFeeEth: 0.000021,
  },
  feeEvidence: {
    rate: "0.003",
    evidence: { transactionHash: txHash, poolAddress: pairAddress, logIndex: 3, source: "verified-pool-state" },
  },
});
assert.equal(singleHopMetrics.priceImpact.status, "DERIVED");
assert.ok(singleHopMetrics.priceImpact.value > 0);
assert.equal(singleHopMetrics.priceImpact.evidence.swap.transactionHash, txHash);
assert.equal(singleHopMetrics.priceImpact.evidence.reserveEvent.logIndex, 4);
assert.equal(singleHopMetrics.tradingFee.status, "DERIVED");
assert.equal(singleHopMetrics.tradingFee.value, "3000000000000000");
assert.equal(singleHopMetrics.tradingFee.rate, "0.003");
assert.equal(singleHopMetrics.gasCost.status, "DERIVED");
assert.equal(singleHopMetrics.gasCost.gasFeeWei, "21000000000000");
assert.equal(singleHopMetrics.gasCost.nativeAmount, 0.000021);

const noReserveMetrics = computeAmmFinancialMetrics({ decodedEvents: [decodedV2Swap] });
assert.equal(noReserveMetrics.priceImpact.status, "UNKNOWN");
assert.equal(noReserveMetrics.priceImpact.value, null);
assert.match(noReserveMetrics.priceImpact.reason, /reserve/i);
assert.equal(noReserveMetrics.tradingFee.status, "UNKNOWN");
assert.equal(noReserveMetrics.gasCost.status, "UNKNOWN");

const metricSyncOne = v2.encodeEventLog(v2.getEvent("Sync"), [1000n, 2000n]);
const metricSyncTwo = v2.encodeEventLog(v2.getEvent("Sync"), [1100n, 2200n]);
const metricMultiHopLogs = [
  ...twoHopLogs,
  { address: poolOne, topics: metricSyncOne.topics, data: metricSyncOne.data, transactionHash: txHash, logIndex: 8 },
  { address: poolTwo, topics: metricSyncTwo.topics, data: metricSyncTwo.data, transactionHash: txHash, logIndex: 9 },
];
const metricMultiHopDecoded = decodeReceiptAmmEvents(metricMultiHopLogs, txHash);
const metricMultiHopRoute = reconstructAmmRoute({ decodedEvents: metricMultiHopDecoded.decodedEvents, logs: metricMultiHopLogs });
const multiHopMetrics = computeAmmFinancialMetrics({
  decodedEvents: metricMultiHopDecoded.decodedEvents,
  route: metricMultiHopRoute.route,
});
assert.equal(multiHopMetrics.hops.length, 2);
assert.equal(multiHopMetrics.priceImpact.status, "PARTIAL");
assert.equal(multiHopMetrics.priceImpact.value, null);
assert.equal(multiHopMetrics.priceImpact.hops.length, 2);
assert.equal(multiHopMetrics.tradingFee.status, "UNKNOWN");
assert.equal(multiHopMetrics.gasCost.status, "UNKNOWN");
assert.equal(multiHopMetrics.hops[0].priceImpact.evidence.reserveEvent.poolAddress, poolOne);
console.log("PASS: 8. AMM metrics derive only from supplied reserve, fee, route, and gas evidence");

// ---------------------------------------------------------------------------
// 9. End-to-end wallet reconstruction with decoded receipt logs
// ---------------------------------------------------------------------------
process.env.ALCHEMY_ETH_RPC_URL = "https://mock.amm.invalid";
delete process.env.METASLEUTH_ADDRESS_LABEL_API_KEY;
delete process.env.METASLEUTH_RISK_SCORE_API_KEY;

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const router = "0x7a250d5630b4cf539739df2c5dacab4c659f2488";
const swapHash = `0x${"99".repeat(32)}`;
const timestamp = "2026-08-21T10:00:00.000Z";

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url).startsWith("https://mock.amm.invalid")) {
    const body = JSON.parse(options.body || "{}");

    if (body.method === "alchemy_getAssetTransfers") {
      const params = body.params[0];
      const transfers = params.toAddress
        ? [{
            hash: swapHash,
            uniqueId: "in-1",
            from: router,
            to: wallet,
            asset: "USDC",
            value: 2500,
            rawContract: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
            category: "erc20",
            blockNum: "0x500",
            metadata: { blockTimestamp: timestamp },
          }]
        : [{
            hash: swapHash,
            uniqueId: "out-1",
            from: wallet,
            to: router,
            asset: "ETH",
            value: 1,
            category: "external",
            blockNum: "0x500",
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
          hash: swapHash,
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
          gasUsed: "0x20000",
          logs: [
            {
              address: pairAddress,
              topics: v2SwapEncoded.topics,
              data: v2SwapEncoded.data,
              transactionHash: swapHash,
              logIndex: "0x2",
            },
            {
              address: pairAddress,
              topics: v2SyncEncoded.topics,
              data: v2SyncEncoded.data,
              transactionHash: swapHash,
              logIndex: "0x3",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }

  if (String(url).startsWith("https://api.frankfurter.app/")) {
    return new Response(JSON.stringify({ rates: { INR: 84.5 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return originalFetch(url, options);
};

const { analyzeEthereumWallet } = await import("../server/src/services/walletTracing.js");
const analysis = await analyzeEthereumWallet(wallet);

assert.equal(analysis.transferCount, 2);
assert.equal(analysis.derivedDexEventCount, 1);
assert.equal(analysis.traceability.complianceRowCount, 1);
assert.equal(analysis.traceability.accountedTransferCount, 2);

const dexTx = analysis.derivedTransactions[0];
assert.equal(dexTx.reconstruction.verifiedByReceipt, true);
// Confidence is now evidence-derived, not a hardcoded 98.
// With opposing flow (35) + AMM swap (40) + receipt success (10) + valuation (5) = 90
assert.equal(typeof dexTx.reconstruction.score, "number");
assert.ok(dexTx.reconstruction.score > 0, "Evidence score must be positive");
assert.ok(dexTx.reconstruction.breakdown, "Breakdown must exist");
assert.ok(dexTx.reconstruction.breakdown.opposingAssetFlow > 0, "Opposing flow evidence");
assert.ok(dexTx.reconstruction.breakdown.receiptAmmSwapEvent > 0, "AMM swap receipt evidence");
assert.equal(dexTx.reconstruction.poolAddress, pairAddress.toLowerCase());
assert.equal(dexTx.reconstruction.decodedEvents.length, 2);
assert.equal(dexTx.reconstruction.decodedEvents[0].eventType, "Swap");
assert.equal(dexTx.reconstruction.decodedEvents[1].eventType, "Sync");
assert.ok(Array.isArray(dexTx.reconstruction.uninterpretedLogs), "uninterpretedLogs must be present");
assert.equal(dexTx.reconstruction.routeStatus, "COMPLETE");
assert.deepEqual(dexTx.reconstruction.logicalInput, { token: "ETH", amount: 1 });
assert.deepEqual(dexTx.reconstruction.logicalOutput, {
  token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  amount: 2500,
});
assert.equal(dexTx.reconstruction.route.length, 1);
assert.equal(dexTx.reconstruction.route[0].poolAddress, pairAddress.toLowerCase());
assert.equal(dexTx.reconstruction.financialMetrics.gasCost.status, "DERIVED");
assert.equal(
  dexTx.reconstruction.financialMetrics.gasCost.gasFeeWei,
  analysis.traceability.inventory[0].gasFeeWei
);
assert.equal(dexTx.reconstruction.financialMetrics.tradingFee.status, "UNKNOWN");
assert.equal(dexTx.reconstruction.financialMetrics.priceImpact.status, "DERIVED");

assert.equal(dexTx.valuationEvidence.decodedReceiptEventCount, 2);
assert.equal(dexTx.valuationEvidence.poolAddress, pairAddress.toLowerCase());
assert.equal(dexTx.valuationEvidence.ammEvents.length, 2);
assert.equal(typeof dexTx.valuationEvidence.uninterpretedLogCount, "number");

const leg = analysis.traceability.transferOutcomes.find((o) => o.type === "DEX_SWAP_LEG");
assert.ok(leg.evidenceSources.includes("Decoded AMM receipt events"));

const inv = analysis.traceability.inventory.find((i) => i.accountedFor);
assert.equal(inv.receiptVerified, true);
assert.equal(inv.poolAddress, pairAddress.toLowerCase());
assert.equal(inv.decodedAmmEvents.length, 2);

console.log("PASS: 7. End-to-end wallet reconstruction with evidence-derived confidence and decoded receipt logs");

// ---------------------------------------------------------------------------
// 8. computeEvidenceConfidence — dynamic scoring, no hardcoded constants
// ---------------------------------------------------------------------------
const fullEvidence = computeEvidenceConfidence({
  hasOpposingFlow: true, hasAmmSwap: true, hasAmmEvent: true,
  isSuccess: true, hasEntityLabel: true, hasValuation: true,
});
assert.equal(fullEvidence.score, 100);
assert.ok(fullEvidence.breakdown.opposingAssetFlow > 0);
assert.ok(fullEvidence.breakdown.receiptAmmSwapEvent > 0);
assert.ok(fullEvidence.breakdown.receiptExecutionConfirmed > 0);
assert.ok(fullEvidence.breakdown.entityMetadataCorroborated > 0);
assert.ok(fullEvidence.breakdown.valuationResolved > 0);
// hasAmmSwap takes precedence; receiptAmmNonSwapEvent must not appear alongside it
assert.equal(fullEvidence.breakdown.receiptAmmNonSwapEvent, undefined);

const noEvidence = computeEvidenceConfidence({});
assert.equal(noEvidence.score, 0);
assert.deepEqual(noEvidence.breakdown, {});

const onlyFlow = computeEvidenceConfidence({ hasOpposingFlow: true });
assert.equal(onlyFlow.score, 35);
assert.deepEqual(Object.keys(onlyFlow.breakdown), ["opposingAssetFlow"]);

// Non-swap AMM event (e.g. Sync) gives partial credit
const syncOnly = computeEvidenceConfidence({ hasOpposingFlow: true, hasAmmEvent: true, isSuccess: true });
assert.equal(syncOnly.score, 65); // 35 + 20 + 10
assert.ok(syncOnly.breakdown.receiptAmmNonSwapEvent > 0);
assert.equal(syncOnly.breakdown.receiptAmmSwapEvent, undefined);

console.log("PASS: 8. computeEvidenceConfidence produces dynamic, evidence-proportional scores");

// ---------------------------------------------------------------------------
// 9. No hardcoded address/selector constants remain in walletTracing
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
const wtSource = readFileSync("server/src/services/walletTracing.js", "utf8");
const metricsSource = readFileSync("server/src/services/ammFinancialMetrics.js", "utf8");
assert.ok(!wtSource.includes("KNOWN_DEX_ADDRESSES"), "KNOWN_DEX_ADDRESSES must not exist");
assert.ok(!wtSource.includes("KNOWN_SWAP_SELECTORS"), "KNOWN_SWAP_SELECTORS must not exist");
assert.ok(!wtSource.includes("knownAddress"), "knownAddress property must not exist");
assert.ok(!wtSource.includes("knownSelector"), "knownSelector property must not exist");
// No fixed confidence constants (98, 95, 85) as DEX confidence assignments
assert.ok(!/confidence:\s*(98|95|85)/.test(wtSource), "Hardcoded confidence values must not exist");
assert.ok(!metricsSource.includes("0.003"), "Universal fee values must not exist");
assert.ok(!metricsSource.includes("Uniswap"), "Protocol names must not exist in metrics logic");
console.log("PASS: 9. No hardcoded DEX addresses, selectors, or confidence constants remain");

console.log("\nALL PHASE 2 + PHASE 2.1 TESTS PASSED SUCCESSFULLY!");
