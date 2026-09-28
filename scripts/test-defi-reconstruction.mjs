import assert from "node:assert/strict";
import { Interface } from "ethers";
import {
  WETH_MAINNET,
  identifyDeFiProtocol,
  reconstructWrapUnwrap,
  reconstructFlashLoan,
  reconstructStaking,
  reconstructBridge,
  reconstructUnknownDefi,
  reconstructDeFiActivity,
} from "../server/src/services/defiReconstruction.js";

// Setup mock interfaces
const wethInterface = new Interface([
  "event Deposit(address indexed dst, uint wad)",
  "event Withdrawal(address indexed src, uint wad)",
]);
const aaveV3Interface = new Interface([
  "event FlashLoan(address indexed target, address initiator, address indexed asset, uint256 amount, uint8 interestRateMode, uint256 premium, uint16 indexed referralCode)",
]);
const lidoInterface = new Interface([
  "event Submitted(address indexed sender, uint256 amount, address referral)",
]);
const erc4626Interface = new Interface([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);
const acrossInterface = new Interface([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, uint32 depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)",
]);

const wallet = "0x1111111111111111111111111111111111111111";
const acrossContract = "0x5c7bcde990431fad346cbdb13391b3ab778f58a2";
const lidoContract = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const aavePool = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

console.log("Starting Person 2: DeFi Reconstruction Tests...");

// ---------------------------------------------------------------------------
// 1. Protocol Identification
// ---------------------------------------------------------------------------
{
  const wethProtocol = identifyDeFiProtocol({ toAddress: WETH_MAINNET });
  assert.equal(wethProtocol.protocol, "WETH9");
  assert.equal(wethProtocol.category, "WRAPPER");
  assert.equal(wethProtocol.confidence, "HIGH");

  const aaveV3Log = {
    address: aavePool,
    topics: [aaveV3Interface.getEvent("FlashLoan").topicHash],
    data: "0x",
  };
  const aaveProtocol = identifyDeFiProtocol({ toAddress: aavePool, logs: [aaveV3Log] });
  assert.equal(aaveProtocol.protocol, "Aave_V3");
  assert.equal(aaveProtocol.category, "LENDING_FLASH_LOAN");

  const lidoLog = {
    address: lidoContract,
    topics: [lidoInterface.getEvent("Submitted").topicHash],
    data: "0x",
  };
  const lidoProtocol = identifyDeFiProtocol({ toAddress: lidoContract, logs: [lidoLog] });
  assert.equal(lidoProtocol.protocol, "Lido");
  assert.equal(lidoProtocol.category, "LIQUID_STAKING");

  const unknownProtocol = identifyDeFiProtocol({ toAddress: "0x9999999999999999999999999999999999999999" });
  assert.equal(unknownProtocol.protocol, null);
  assert.equal(unknownProtocol.isIdentified, false);
  assert.equal(unknownProtocol.confidence, "LOW");

  console.log("PASS: 1. Protocol identification from event topics, addresses, and labels");
}

// ---------------------------------------------------------------------------
// 2. Wrap / Unwrap Reconstruction
// ---------------------------------------------------------------------------
{
  const txHash = `0x${"aa".repeat(32)}`;
  const depositEncoded = wethInterface.encodeEventLog(wethInterface.getEvent("Deposit"), [
    wallet,
    1500000000000000000n, // 1.5 ETH
  ]);
  const wrapRecord = {
    receipt: {
      status: "0x1",
      logs: [{ address: WETH_MAINNET, topics: depositEncoded.topics, data: depositEncoded.data }],
    },
  };

  const wrapResult = reconstructWrapUnwrap({
    txHash,
    txRecord: wrapRecord,
    outgoing: [{ asset: "ETH", outgoingAmount: 1.5, transferRefs: [`${txHash}-out`] }],
    incoming: [{ asset: "WETH", incomingAmount: 1.5, transferRefs: [`${txHash}-in`] }],
    rootAddress: wallet,
  });

  assert.ok(wrapResult);
  assert.equal(wrapResult.kind, "WRAP");
  assert.equal(wrapResult.protocol, "WETH9");
  assert.equal(wrapResult.contractAddress, WETH_MAINNET);
  assert.equal(wrapResult.inputAssets[0].asset, "ETH");
  assert.equal(wrapResult.inputAssets[0].amount, 1.5);
  assert.equal(wrapResult.outputAssets[0].asset, "WETH");
  assert.equal(wrapResult.outputAssets[0].amount, 1.5);
  assert.deepEqual(wrapResult.sourceTransferRefs, [`${txHash}-out`, `${txHash}-in`]);
  assert.equal(wrapResult.reconstructionStatus, "VERIFIED");
  assert.equal(wrapResult.reviewRequired, false);

  // Unwrap
  const unwrapHash = `0x${"ab".repeat(32)}`;
  const withdrawEncoded = wethInterface.encodeEventLog(wethInterface.getEvent("Withdrawal"), [
    wallet,
    2000000000000000000n, // 2.0 ETH
  ]);
  const unwrapRecord = {
    receipt: {
      status: "0x1",
      logs: [{ address: WETH_MAINNET, topics: withdrawEncoded.topics, data: withdrawEncoded.data }],
    },
  };
  const unwrapResult = reconstructWrapUnwrap({
    txHash: unwrapHash,
    txRecord: unwrapRecord,
    outgoing: [{ asset: "WETH", outgoingAmount: 2.0, transferRefs: [`${unwrapHash}-out`] }],
    incoming: [{ asset: "ETH", incomingAmount: 2.0, transferRefs: [`${unwrapHash}-in`] }],
    rootAddress: wallet,
  });
  assert.ok(unwrapResult);
  assert.equal(unwrapResult.kind, "UNWRAP");
  assert.equal(unwrapResult.inputAssets[0].asset, "WETH");
  assert.equal(unwrapResult.outputAssets[0].asset, "ETH");
  assert.equal(unwrapResult.reconstructionStatus, "VERIFIED");

  console.log("PASS: 2. WRAP and UNWRAP reconstruction from WETH receipt events");
}

// ---------------------------------------------------------------------------
// 3. Bridge Reconstruction
// ---------------------------------------------------------------------------
{
  const txHash = `0x${"bb".repeat(32)}`;
  const acrossEncoded = acrossInterface.encodeEventLog(acrossInterface.getEvent("FundsDeposited"), [
    `0x${"11".repeat(32)}`, // inputToken
    `0x${"22".repeat(32)}`, // outputToken
    100000000n, // inputAmount: 100 USDC
    99900000n, // outputAmount
    10n, // destinationChainId: Optimism
    12345, // depositId
    1600000000,
    1600001000,
    1600002000,
    wallet, // depositor
    wallet, // recipient
    "0x0000000000000000000000000000000000000000",
    "0x",
  ]);
  const bridgeRecord = {
    transaction: { to: acrossContract },
    receipt: {
      status: "0x1",
      logs: [{ address: acrossContract, topics: acrossEncoded.topics, data: acrossEncoded.data }],
    },
  };
  const bridgeResult = reconstructBridge({
    txHash,
    txRecord: bridgeRecord,
    outgoing: [{ asset: "USDC", outgoingAmount: 100, tokenAddress: usdc, transferRefs: [`${txHash}-out`] }],
    incoming: [],
    protocolInfo: { protocol: "Across", category: "BRIDGE", isIdentified: true },
  });

  assert.ok(bridgeResult);
  assert.equal(bridgeResult.kind, "BRIDGE");
  assert.equal(bridgeResult.protocol, "Across");
  assert.equal(bridgeResult.destinationChain, "10");
  assert.equal(bridgeResult.recipient, wallet.toLowerCase());
  assert.equal(bridgeResult.inputAssets[0].asset, "USDC");
  assert.equal(bridgeResult.inputAssets[0].amount, 100);
  assert.deepEqual(bridgeResult.sourceTransferRefs, [`${txHash}-out`]);
  assert.equal(bridgeResult.reconstructionStatus, "VERIFIED");
  assert.equal(bridgeResult.reviewRequired, false);

  console.log("PASS: 3. Bridge reconstruction with destination chain extraction and sourceTransferRefs");
}

// ---------------------------------------------------------------------------
// 4. Staking / Unstaking Reconstruction
// ---------------------------------------------------------------------------
{
  const txHash = `0x${"cc".repeat(32)}`;
  const submittedEncoded = lidoInterface.encodeEventLog(lidoInterface.getEvent("Submitted"), [
    wallet,
    32000000000000000000n, // 32 ETH
    "0x0000000000000000000000000000000000000000",
  ]);
  const lidoRecord = {
    transaction: { to: lidoContract },
    receipt: {
      status: "0x1",
      logs: [{ address: lidoContract, topics: submittedEncoded.topics, data: submittedEncoded.data }],
    },
  };
  const stakeResult = reconstructStaking({
    txHash,
    txRecord: lidoRecord,
    outgoing: [{ asset: "ETH", outgoingAmount: 32, transferRefs: [`${txHash}-out`] }],
    incoming: [{ asset: "STETH", incomingAmount: 32, transferRefs: [`${txHash}-in`] }],
    protocolInfo: { protocol: "Lido", category: "LIQUID_STAKING", isIdentified: true },
  });

  assert.ok(stakeResult);
  assert.equal(stakeResult.kind, "STAKE");
  assert.equal(stakeResult.protocol, "Lido");
  assert.equal(stakeResult.inputAssets[0].asset, "ETH");
  assert.equal(stakeResult.inputAssets[0].amount, 32);
  assert.equal(stakeResult.reconstructionStatus, "VERIFIED");

  // ERC-4626 Unstake (Withdraw)
  const unstakeHash = `0x${"cd".repeat(32)}`;
  const withdrawVaultEncoded = erc4626Interface.encodeEventLog(erc4626Interface.getEvent("Withdraw"), [
    wallet,
    wallet,
    wallet,
    500000000n, // 500 USDC
    500000000n, // shares
  ]);
  const vaultContract = "0x7777777777777777777777777777777777777777";
  const unstakeRecord = {
    transaction: { to: vaultContract },
    receipt: {
      status: "0x1",
      logs: [{ address: vaultContract, topics: withdrawVaultEncoded.topics, data: withdrawVaultEncoded.data }],
    },
  };
  const unstakeResult = reconstructStaking({
    txHash: unstakeHash,
    txRecord: unstakeRecord,
    outgoing: [],
    incoming: [{ asset: "USDC", incomingAmount: 500, transferRefs: [`${unstakeHash}-in`] }],
    protocolInfo: { protocol: "ERC4626_Vault", category: "VAULT_STAKING", isIdentified: true },
  });
  assert.ok(unstakeResult);
  assert.equal(unstakeResult.kind, "UNSTAKE");
  assert.equal(unstakeResult.outputAssets[0].asset, "USDC");
  assert.equal(unstakeResult.outputAssets[0].amount, 500);

  console.log("PASS: 4. Staking (Lido) and Unstaking (ERC-4626) verified from event logs");
}

// ---------------------------------------------------------------------------
// 5. Flash Loan Reconstruction
// ---------------------------------------------------------------------------
{
  const txHash = `0x${"dd".repeat(32)}`;
  const flashEncoded = aaveV3Interface.encodeEventLog(aaveV3Interface.getEvent("FlashLoan"), [
    wallet, // target
    wallet, // initiator
    usdc, // asset
    1000000000000n, // amount: 1M USDC
    0, // interestRateMode
    500000000n, // premium: 500 USDC
    0, // referralCode
  ]);
  const flashRecord = {
    transaction: { to: aavePool },
    receipt: {
      status: "0x1",
      logs: [{ address: aavePool, topics: flashEncoded.topics, data: flashEncoded.data }],
    },
  };
  const flashResult = reconstructFlashLoan({
    txHash,
    txRecord: flashRecord,
    movements: [
      { asset: "USDC", incomingAmount: 1000000, transferRefs: [`${txHash}-in`] },
      { asset: "USDC", outgoingAmount: 1000500, transferRefs: [`${txHash}-out`] },
    ],
    protocolInfo: { protocol: "Aave_V3", category: "LENDING_FLASH_LOAN", isIdentified: true },
  });

  assert.ok(flashResult);
  assert.equal(flashResult.kind, "FLASH_LOAN");
  assert.equal(flashResult.protocol, "Aave_V3");
  assert.equal(flashResult.contractAddress, aavePool.toLowerCase());
  assert.equal(flashResult.borrowedAssets[0].amount, "1000000000000");
  assert.equal(flashResult.repaymentAssets[0].fee, "500000000");
  assert.equal(flashResult.reviewRequired, false);

  console.log("PASS: 5. Flash loan detection with borrowed assets, fees, and protocol identification");
}

// ---------------------------------------------------------------------------
// 6. Unknown DeFi Reconstruction with REVIEW_REQUIRED
// ---------------------------------------------------------------------------
{
  const txHash = `0x${"ee".repeat(32)}`;
  const contractAddress = "0x8888888888888888888888888888888888888888";
  const unknownRecord = {
    transaction: { to: contractAddress, input: "0x12345678abcdef" },
    receipt: {
      status: "0x1",
      logs: [{ address: contractAddress, topics: [`0x${"33".repeat(32)}`], data: "0x1234" }],
    },
  };
  const unknownResult = reconstructDeFiActivity({
    txHash,
    movements: [{ asset: "DAI", outgoingAmount: 50, transferRefs: [`${txHash}-out`] }],
    txRecord: unknownRecord,
    label: null,
    rootAddress: wallet,
  });

  assert.ok(unknownResult);
  assert.equal(unknownResult.kind, "UNKNOWN_DEFI");
  assert.equal(unknownResult.reviewRequired, true);
  assert.equal(unknownResult.reconstructionStatus, "REVIEW_REQUIRED");
  assert.equal(unknownResult.contractAddress, contractAddress.toLowerCase());
  assert.ok(unknownResult.rawEvidence.length > 0);
  assert.ok(unknownResult.reason.includes("manual review required"));

  console.log("PASS: 6. Unknown DeFi fallback flags REVIEW_REQUIRED and preserves raw logs");
}

// ---------------------------------------------------------------------------
// 7. End-to-End analyzeEthereumWallet Integration & Double-Counting Check
// ---------------------------------------------------------------------------
{
  // Test wallet with multiple diverse DeFi transactions
  const e2eWallet = "0x2222222222222222222222222222222222222222";
  const swapHash = `0x${"10".repeat(32)}`;
  const wrapHash = `0x${"20".repeat(32)}`;
  const bridgeHash = `0x${"30".repeat(32)}`;
  const timestamp = "2026-09-20T12:00:00.000Z";

  // Mock global.fetch for this test
  const originalFetch = global.fetch;
  const v2Interface = new Interface([
    "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
    "event Sync(uint112 reserve0, uint112 reserve1)",
  ]);
  const v2SwapLog = v2Interface.encodeEventLog(v2Interface.getEvent("Swap"), [
    "0x7a250d5630b4cf539739df2c5dacab4c659f2488",
    100000000000000000n, // 0.1 ETH
    0n,
    0n,
    250000000n, // 250 USDC
    e2eWallet,
  ]);
  const v2SyncLog = v2Interface.encodeEventLog(v2Interface.getEvent("Sync"), [
    1000000000000000000000n,
    2500000000000n,
  ]);

  const wrapDepositLog = wethInterface.encodeEventLog(wethInterface.getEvent("Deposit"), [
    e2eWallet,
    1000000000000000000n, // 1 ETH
  ]);

  const bridgeEventLog = acrossInterface.encodeEventLog(acrossInterface.getEvent("FundsDeposited"), [
    `0x${"11".repeat(32)}`,
    `0x${"22".repeat(32)}`,
    500000000n, // 500 USDC
    499000000n,
    10n,
    999,
    1600000000,
    1600001000,
    1600002000,
    e2eWallet,
    e2eWallet,
    "0x0000000000000000000000000000000000000000",
    "0x",
  ]);

  const transfers = [
    // Swap legs (0.1 ETH -> 250 USDC)
    { hash: swapHash, uniqueId: "swap-out", from: e2eWallet, to: "0x7a250d5630b4cf539739df2c5dacab4c659f2488", asset: "ETH", value: 0.1, category: "external", blockNum: "0x1", metadata: { blockTimestamp: timestamp } },
    { hash: swapHash, uniqueId: "swap-in", from: "0x7a250d5630b4cf539739df2c5dacab4c659f2488", to: e2eWallet, asset: "USDC", value: 250, rawContract: { address: usdc, decimals: 6 }, category: "erc20", blockNum: "0x1", metadata: { blockTimestamp: timestamp } },
    // Wrap legs (1 ETH -> 1 WETH)
    { hash: wrapHash, uniqueId: "wrap-out", from: e2eWallet, to: WETH_MAINNET, asset: "ETH", value: 1, category: "external", blockNum: "0x2", metadata: { blockTimestamp: timestamp } },
    { hash: wrapHash, uniqueId: "wrap-in", from: WETH_MAINNET, to: e2eWallet, asset: "WETH", value: 1, rawContract: { address: WETH_MAINNET, decimals: 18 }, category: "erc20", blockNum: "0x2", metadata: { blockTimestamp: timestamp } },
    // Bridge leg (500 USDC out to Across bridge)
    { hash: bridgeHash, uniqueId: "bridge-out", from: e2eWallet, to: acrossContract, asset: "USDC", value: 500, rawContract: { address: usdc, decimals: 6 }, category: "erc20", blockNum: "0x3", metadata: { blockTimestamp: timestamp } },
  ];

  process.env.ALCHEMY_ETH_RPC_URL = "https://e2e.mock";
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://e2e.mock")) {
      const body = JSON.parse(options.body || "{}");
      if (body.method === "alchemy_getAssetTransfers") {
        const isIncoming = Boolean(body.params[0].toAddress);
        const result = transfers.filter((t) => isIncoming ? t.to === e2eWallet : t.from === e2eWallet);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { transfers: result } }), { status: 200 });
      }
      if (body.method === "eth_getTransactionByHash") {
        const h = body.params[0];
        if (h === swapHash) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { hash: h, to: "0x7a250d5630b4cf539739df2c5dacab4c659f2488", input: "0x7ff36ab500" } }), { status: 200 });
        if (h === wrapHash) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { hash: h, to: WETH_MAINNET, input: "0xd0e30db0" } }), { status: 200 });
        if (h === bridgeHash) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { hash: h, to: acrossContract, input: "0x12345678" } }), { status: 200 });
      }
      if (body.method === "eth_getTransactionReceipt") {
        const h = body.params[0];
        if (h === swapHash) {
          return new Response(JSON.stringify({
            jsonrpc: "2.0", id: 1,
            result: {
              status: "0x1",
              logs: [
                { address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", topics: v2SwapLog.topics, data: v2SwapLog.data, transactionHash: h, logIndex: 1 },
                { address: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", topics: v2SyncLog.topics, data: v2SyncLog.data, transactionHash: h, logIndex: 2 },
              ],
            },
          }), { status: 200 });
        }
        if (h === wrapHash) {
          return new Response(JSON.stringify({
            jsonrpc: "2.0", id: 1,
            result: {
              status: "0x1",
              logs: [{ address: WETH_MAINNET, topics: wrapDepositLog.topics, data: wrapDepositLog.data, transactionHash: h, logIndex: 1 }],
            },
          }), { status: 200 });
        }
        if (h === bridgeHash) {
          return new Response(JSON.stringify({
            jsonrpc: "2.0", id: 1,
            result: {
              status: "0x1",
              logs: [{ address: acrossContract, topics: bridgeEventLog.topics, data: bridgeEventLog.data, transactionHash: h, logIndex: 1 }],
            },
          }), { status: 200 });
        }
      }
    }
    if (String(url).startsWith("https://api.frankfurter.app/")) {
      return new Response(JSON.stringify({ rates: { INR: 84.0 } }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  const { analyzeEthereumWallet } = await import("../server/src/services/walletTracing.js?e2e");
  const analysis = await analyzeEthereumWallet(e2eWallet);

  // Check event counts
  assert.equal(analysis.transferCount, 5);
  assert.equal(analysis.derivedDexEventCount, 1, "Only swap becomes a taxable DEX row");
  assert.equal(analysis.derivedTransactions.length, 1, "Only 1 compliance row for the DEX swap");
  assert.equal(analysis.derivedDeFiEventCount, 2, "Wrap and Bridge are reconstructed as DeFi events");
  assert.equal(analysis.derivedDeFiEvents.length, 2);

  const wrapEvent = analysis.derivedDeFiEvents.find((e) => e.kind === "WRAP");
  assert.ok(wrapEvent, "WRAP economic event was derived");
  assert.equal(wrapEvent.protocol, "WETH9");
  assert.equal(wrapEvent.sourceTransferRefs.length, 2);

  const bridgeEvent = analysis.derivedDeFiEvents.find((e) => e.kind === "BRIDGE");
  assert.ok(bridgeEvent, "BRIDGE economic event was derived");
  assert.equal(bridgeEvent.destinationChain, "10");
  assert.equal(bridgeEvent.sourceTransferRefs.length, 1);

  // Check traceability & double counting prevention
  assert.equal(analysis.traceability.rawTransferCount, 5);
  assert.equal(analysis.traceability.classifiedTransferCount, 5);
  assert.equal(analysis.traceability.complianceRowCount, 1, "Only 1 compliance row to prevent double-counting");
  assert.equal(analysis.traceability.outcomeCounts.DEX_SWAP_LEG, 2);
  assert.equal(analysis.traceability.outcomeCounts.WRAP_UNWRAP_LEG, 2);
  assert.equal(analysis.traceability.outcomeCounts.BRIDGE_LEG, 1);

  // Check inventory linkage
  const wrapItem = analysis.traceability.inventory.find((i) => i.txHash === wrapHash && i.direction === "OUT");
  assert.equal(wrapItem.status, "RECONSTRUCTED_WRAP_LEG");
  assert.equal(wrapItem.accountedFor, true);
  assert.equal(wrapItem.linkedEconomicEventId, wrapEvent.id);

  const bridgeItem = analysis.traceability.inventory.find((i) => i.txHash === bridgeHash);
  assert.equal(bridgeItem.status, "RECONSTRUCTED_BRIDGE_LEG");
  assert.equal(bridgeItem.accountedFor, true);
  assert.equal(bridgeItem.linkedEconomicEventId, bridgeEvent.id);

  // Downstream compliance check
  const { analyzeRows } = await import("../server/src/compliance/tds.js");
  const compliance = analyzeRows(analysis.derivedTransactions);
  assert.equal(compliance.rows.length, 1, "Compliance engine receives ONLY the single economic DEX swap row");

  console.log("PASS: 7. End-to-end analyzeEthereumWallet integration, traceability, and double-counting prevention");
  global.fetch = originalFetch;
}

console.log("\nALL PERSON 2 DEFI RECONSTRUCTION TESTS PASSED SUCCESSFULLY!\n");
