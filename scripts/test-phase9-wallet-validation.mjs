import assert from "node:assert/strict";
import { Interface } from "ethers";

process.env.ALCHEMY_ETH_RPC_URL = "https://phase9.mock";
delete process.env.METASLEUTH_ADDRESS_LABEL_API_KEY;
delete process.env.METASLEUTH_RISK_SCORE_API_KEY;

const wallet = "0x1000000000000000000000000000000000000001";
const counterparty = "0x2000000000000000000000000000000000000002";
const poolOne = "0x3000000000000000000000000000000000000003";
const poolTwo = "0x4000000000000000000000000000000000000004";
const tokenA = "0x5000000000000000000000000000000000000005";
const tokenB = "0x6000000000000000000000000000000000000006";
const tokenC = "0x7000000000000000000000000000000000000007";
const tokenD = "0x8000000000000000000000000000000000000008";
const hashes = Object.fromEntries([
  ["ordinary", "01"], ["single", "02"], ["multi", "03"], ["add", "04"],
  ["remove", "05"], ["open", "06"], ["unknown", "07"], ["ambiguous", "08"],
].map(([name, byte]) => [name, `0x${byte.repeat(32)}`]));
const timestamp = "2026-09-19T10:00:00.000Z";
const v2 = new Interface([
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
]);
const erc20 = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

function transfer(address, from, to, value, transactionHash, logIndex) {
  const encoded = erc20.encodeEventLog(erc20.getEvent("Transfer"), [from, to, value]);
  return { address, topics: encoded.topics, data: encoded.data, transactionHash, logIndex };
}
function eventLog(address, eventName, args, transactionHash, logIndex) {
  const encoded = v2.encodeEventLog(v2.getEvent(eventName), args);
  return { address, topics: encoded.topics, data: encoded.data, transactionHash, logIndex };
}
function tx(hash) {
  return { hash, to: counterparty, input: `0xabcdef01${"00".repeat(32)}`, gasPrice: "0x3b9aca00" };
}
function receipt(hash, logs) {
  return { status: "0x1", gasUsed: "0x5208", logs: logs.map((log) => ({ ...log, transactionHash: hash })) };
}

const logsByHash = {
  [hashes.ordinary]: [],
  [hashes.single]: [
    eventLog(poolOne, "Swap", [counterparty, 1000000000000000000n, 0n, 0n, 2500000000n, wallet], hashes.single, 2),
    eventLog(poolOne, "Sync", [5000000000000000000000n, 20000000000000n], hashes.single, 3),
  ],
  [hashes.multi]: [
    transfer(tokenA, counterparty, poolOne, 10n, hashes.multi, 1),
    transfer(tokenB, poolOne, counterparty, 9n, hashes.multi, 2),
    eventLog(poolOne, "Swap", [counterparty, 10n, 0n, 0n, 9n, counterparty], hashes.multi, 3),
    transfer(tokenB, counterparty, poolTwo, 9n, hashes.multi, 4),
    transfer(tokenC, poolTwo, counterparty, 8n, hashes.multi, 5),
    eventLog(poolTwo, "Swap", [counterparty, 9n, 0n, 0n, 8n, counterparty], hashes.multi, 6),
    eventLog(poolOne, "Sync", [1000n, 2000n], hashes.multi, 7),
    eventLog(poolTwo, "Sync", [1100n, 2200n], hashes.multi, 8),
  ],
  [hashes.add]: [
    transfer(tokenA, wallet, poolOne, 100n, hashes.add, 1),
    transfer(tokenB, wallet, poolOne, 200n, hashes.add, 2),
    eventLog(poolOne, "Mint", [wallet, 100n, 200n], hashes.add, 3),
  ],
  [hashes.remove]: [
    transfer(tokenA, poolOne, wallet, 40n, hashes.remove, 1),
    transfer(tokenB, poolOne, wallet, 80n, hashes.remove, 2),
    eventLog(poolOne, "Burn", [wallet, 40n, 80n, wallet], hashes.remove, 3),
  ],
  [hashes.open]: [
    transfer(tokenC, wallet, poolTwo, 50n, hashes.open, 1),
    transfer(tokenD, wallet, poolTwo, 100n, hashes.open, 2),
    eventLog(poolTwo, "Mint", [wallet, 50n, 100n], hashes.open, 3),
  ],
  [hashes.unknown]: [{ address: counterparty, topics: ["0x1234"], data: "0x12", logIndex: 1 }],
  [hashes.ambiguous]: [{ address: counterparty, topics: ["0x1234"], data: "0x", logIndex: 1 }],
};

const incoming = [
  { hash: hashes.ordinary, uniqueId: "ordinary-in", from: counterparty, to: wallet, asset: "DAI", value: 10, rawContract: { address: tokenD, decimals: 18 }, category: "erc20", blockNum: "0x101", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.single, uniqueId: "single-in", from: counterparty, to: wallet, asset: "USDC", value: 2500, rawContract: { address: tokenB, decimals: 6 }, category: "erc20", blockNum: "0x102", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.multi, uniqueId: "multi-in", from: counterparty, to: wallet, asset: "TOKEN_C", value: 8, rawContract: { address: tokenC, decimals: 18 }, category: "erc20", blockNum: "0x103", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.remove, uniqueId: "remove-a", from: poolOne, to: wallet, asset: "TOKEN_A", value: 40, rawContract: { address: tokenA, decimals: 18 }, category: "erc20", blockNum: "0x105", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.remove, uniqueId: "remove-b", from: poolOne, to: wallet, asset: "TOKEN_B", value: 80, rawContract: { address: tokenB, decimals: 18 }, category: "erc20", blockNum: "0x105", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.unknown, uniqueId: "unknown-in", from: counterparty, to: wallet, asset: "UNKNOWN", value: 1, category: "erc20", blockNum: "0x107", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.ambiguous, uniqueId: "ambiguous-in", from: counterparty, to: wallet, asset: "TOKEN_C", value: 2, rawContract: { address: tokenC, decimals: 18 }, category: "erc20", blockNum: "0x108", metadata: { blockTimestamp: timestamp } },
];
const outgoing = [
  { hash: hashes.ordinary, uniqueId: "ordinary-out", from: wallet, to: counterparty, asset: "ETH", value: 0.01, category: "external", blockNum: "0x101", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.single, uniqueId: "single-out", from: wallet, to: counterparty, asset: "ETH", value: 1, category: "external", blockNum: "0x102", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.multi, uniqueId: "multi-out", from: wallet, to: counterparty, asset: "TOKEN_A", value: 10, rawContract: { address: tokenA, decimals: 18 }, category: "erc20", blockNum: "0x103", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.add, uniqueId: "add-a", from: wallet, to: counterparty, asset: "TOKEN_A", value: 100, rawContract: { address: tokenA, decimals: 18 }, category: "erc20", blockNum: "0x104", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.add, uniqueId: "add-b", from: wallet, to: counterparty, asset: "TOKEN_B", value: 200, rawContract: { address: tokenB, decimals: 18 }, category: "erc20", blockNum: "0x104", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.open, uniqueId: "open-a", from: wallet, to: counterparty, asset: "TOKEN_C", value: 50, rawContract: { address: tokenC, decimals: 18 }, category: "erc20", blockNum: "0x106", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.open, uniqueId: "open-b", from: wallet, to: counterparty, asset: "TOKEN_D", value: 100, rawContract: { address: tokenD, decimals: 18 }, category: "erc20", blockNum: "0x106", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.unknown, uniqueId: "unknown-out", from: wallet, to: counterparty, asset: "TOKEN_A", value: 1, rawContract: { address: tokenA, decimals: 18 }, category: "erc20", blockNum: "0x107", metadata: { blockTimestamp: timestamp } },
  { hash: hashes.ambiguous, uniqueId: "ambiguous-out", from: wallet, to: counterparty, asset: "TOKEN_A", value: 2, rawContract: { address: tokenA, decimals: 18 }, category: "erc20", blockNum: "0x108", metadata: { blockTimestamp: timestamp } },
];

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url).startsWith("https://phase9.mock")) {
    const body = JSON.parse(options.body || "{}");
    if (body.method === "alchemy_getAssetTransfers") {
      const requestedAddress = body.params[0].toAddress || body.params[0].fromAddress;
      const result = requestedAddress === wallet
        ? (body.params[0].toAddress ? incoming : outgoing)
        : [];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { transfers: result } }), { status: 200 });
    }
    if (body.method === "eth_getTransactionByHash") {
      const hash = body.params[0];
      if (hash === hashes.unknown) {
        return new Response(JSON.stringify({ error: "mock transaction unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: tx(hash) }), { status: 200 });
    }
    if (body.method === "eth_getTransactionReceipt") {
      const hash = body.params[0];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt(hash, logsByHash[hash] || []) }), { status: 200 });
    }
  }
  if (String(url).startsWith("https://api.frankfurter.app/")) {
    return new Response(JSON.stringify({ rates: { INR: 84 } }), { status: 200 });
  }
  return originalFetch(url, options);
};

const { analyzeEthereumWallet } = await import("../server/src/services/walletTracing.js?phase9");
const { analyzeRows } = await import("../server/src/compliance/tds.js");
const { reconcile } = await import("../src/utils/reconcile.js");
const analysis = await analyzeEthereumWallet(wallet);
const emptyAnalysis = await analyzeEthereumWallet("0x1000000000000000000000000000000000000009");

assert.equal(analysis.transferCount, incoming.length + outgoing.length);
assert.equal(emptyAnalysis.transferCount, 0);
assert.equal(emptyAnalysis.derivedDexEventCount, 0);
assert.equal(emptyAnalysis.derivedLiquidityEventCount, 0);
assert.equal(analysis.derivedDexEventCount, 2, "Only single-hop and multi-hop swaps become DEX rows");
assert.equal(analysis.derivedTransactions.length, 2);
assert.equal(analysis.derivedTransactions.filter((event) => event.reconstruction.route?.length === 2).length, 1);
assert.equal(analysis.derivedLiquidityEventCount, 3, "Add, partial remove, and open add are retained");
assert.ok(analysis.derivedLiquidityPositions.length >= 2);
assert.ok(analysis.derivedLiquidityPositions.some((position) => position.positionStatus === "PARTIALLY_REMOVED" || position.positionStatus === "UNMATCHED_REMOVAL"));
assert.ok(analysis.derivedLiquidityPositions.some((position) => position.positionStatus === "OPEN" || position.positionStatus === "OPEN_UNOWNED"));
assert.equal(analysis.traceability.complianceRowCount, analysis.derivedDexEventCount);
assert.equal(analysis.traceability.outcomeCounts.DEX_SWAP_LEG, 4, "Two swaps have two wallet legs each");
assert.ok(analysis.traceability.transferOutcomes.some((outcome) => outcome.status === "PENDING_MANUAL_REVIEW"));
assert.ok(analysis.derivedTransactions.every((event) => event.reconstruction.financialMetrics.gasCost.status === "DERIVED"));
assert.ok(analysis.derivedTransactions.every((event) => event.reconstruction.financialMetrics.tradingFee.status === "UNKNOWN"));
assert.ok(analysis.derivedTransactions.every((event) => event.valuationEvidence.transactionHash === event.txHash));
assert.ok(analysis.traceability.inventory.filter((item) => item.txHash !== hashes.unknown).every((item) => item.gasFeeWei === "21000000000000"));
assert.equal(analysis.traceability.inventory.filter((item) => item.txHash === hashes.unknown).every((item) => item.gasFeeWei === null), true);

const compliance = analyzeRows(analysis.derivedTransactions);
const reconciliation = reconcile(compliance.rows);
assert.equal(compliance.rows.length, 2, "DEX swaps appear exactly once each");
assert.equal(reconciliation.transferChecks.length, 0);
const mixedCompliance = analyzeRows([
  {
    exchange: "CEX fixture",
    type: "SELL",
    asset: "BTC",
    assetType: "VDA",
    amount: 1,
    inrValue: 100,
    unitPrice: 100,
    quoteCurrency: "INR",
    tdsStatus: "DEDUCTED",
    tdsAmount: 1,
    refId: "cex-fixture",
  },
  ...analysis.derivedTransactions,
]);
assert.equal(mixedCompliance.rows.length, 3, "CEX and DEX rows remain distinct");
assert.equal(mixedCompliance.rows[0].exchange, "CEX fixture");
assert.equal(analysis.derivedLiquidityEvents.every((event) => event.interpretationStatus), true);
assert.equal(analysis.derivedTransactions.some((event) => event.txHash === hashes.unknown), false);
assert.equal(analysis.derivedTransactions.some((event) => event.txHash === hashes.ambiguous), false);
console.log("PASS: Phase 9 mocked wallet ingestion, DEX classes, evidence, gas, UNKNOWN states, and double-counting checks");
