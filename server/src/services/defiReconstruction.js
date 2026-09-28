import { Interface } from "ethers";

// ---------------------------------------------------------------------------
// Canonical contract addresses & common topic hashes (Ethereum Mainnet)
// ---------------------------------------------------------------------------
export const WETH_MAINNET = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// WETH9 events
const wethInterface = new Interface([
  "event Deposit(address indexed dst, uint wad)",
  "event Withdrawal(address indexed src, uint wad)",
]);
const WETH_DEPOSIT_TOPIC = wethInterface.getEvent("Deposit").topicHash.toLowerCase();
const WETH_WITHDRAWAL_TOPIC = wethInterface.getEvent("Withdrawal").topicHash.toLowerCase();

// ERC20 Transfer
const erc20Interface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const TRANSFER_TOPIC = erc20Interface.getEvent("Transfer").topicHash.toLowerCase();

// Flash Loan events
const flashLoanInterface = new Interface([
  // Aave V2 FlashLoan
  "event FlashLoan(address indexed target, address indexed initiator, address indexed asset, uint256 amount, uint256 premium, uint16 referralCode)",
  // Aave V3 FlashLoan
  "event FlashLoan(address indexed target, address initiator, address indexed asset, uint256 amount, uint8 interestRateMode, uint256 premium, uint16 indexed referralCode)",
  // Uniswap V3 Flash
  "event Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1)",
  // Balancer V2 FlashLoan
  "event FlashLoan(address indexed recipient, address indexed token, uint256 amount, uint256 feeAmount)",
]);

const AAVE_V2_FLASH_TOPIC = flashLoanInterface.getEvent("FlashLoan(address,address,address,uint256,uint256,uint16)").topicHash.toLowerCase();
const AAVE_V3_FLASH_TOPIC = flashLoanInterface.getEvent("FlashLoan(address,address,address,uint256,uint8,uint256,uint16)").topicHash.toLowerCase();
const BALANCER_FLASH_TOPIC = flashLoanInterface.getEvent("FlashLoan(address,address,uint256,uint256)").topicHash.toLowerCase();
const UNISWAP_V3_FLASH_TOPIC = flashLoanInterface.getEvent("Flash").topicHash.toLowerCase();

// Staking events
const stakingInterface = new Interface([
  // Lido stETH Submitted
  "event Submitted(address indexed sender, uint256 amount, address referral)",
  // RocketPool DepositReceived
  "event DepositReceived(address indexed from, uint256 amount, uint256 time)",
  // ERC4626 Deposit & Withdraw
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  // Synthetix / generic StakingRewards
  "event Staked(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount)",
]);

const LIDO_SUBMITTED_TOPIC = stakingInterface.getEvent("Submitted").topicHash.toLowerCase();
const ERC4626_DEPOSIT_TOPIC = stakingInterface.getEvent("Deposit").topicHash.toLowerCase();
const ERC4626_WITHDRAW_TOPIC = stakingInterface.getEvent("Withdraw").topicHash.toLowerCase();
const STAKED_GENERIC_TOPIC = stakingInterface.getEvent("Staked").topicHash.toLowerCase();
const WITHDRAWN_GENERIC_TOPIC = stakingInterface.getEvent("Withdrawn").topicHash.toLowerCase();

// Bridge events
const bridgeInterface = new Interface([
  // Across V3 FundsDeposited
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, uint32 depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)",
  // Wormhole Core LogMessagePublished
  "event LogMessagePublished(address sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
  // Stargate / LayerZero Packet / SendMsg
  "event SendMsg(uint8 indexed msgType, uint64 nonce)",
  // Hop TransferSent
  "event TransferSent(bytes32 indexed transferId, uint256 chainId, address indexed recipient, uint256 amount, uint256 transferNonce, uint256 relayerFee)",
  // Arbitrum Inbox
  "event InboxMessageDelivered(uint256 indexed messageNum, bytes data)",
  // Optimism / Base L1StandardBridge ETHDepositInitiated / ERC20DepositInitiated
  "event ETHDepositInitiated(address indexed from, address indexed to, uint256 amount, bytes extraData)",
  "event ERC20DepositInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)",
  "event ETHWithdrawalFinalized(address indexed from, address indexed to, uint256 amount, bytes extraData)",
  "event ERC20WithdrawalFinalized(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)",
]);

const WORMHOLE_LOG_TOPIC = "0x6eb2240bc2d0a0d92305a49d50453535928d8b671a5c13ec441019e1e929f257".toLowerCase();
const ACROSS_FUNDS_DEPOSITED_TOPIC = bridgeInterface.getEvent("FundsDeposited").topicHash.toLowerCase();
const HOP_TRANSFER_SENT_TOPIC = bridgeInterface.getEvent("TransferSent").topicHash.toLowerCase();
const OPTIMISM_ETH_DEPOSIT_TOPIC = bridgeInterface.getEvent("ETHDepositInitiated").topicHash.toLowerCase();
const OPTIMISM_ERC20_DEPOSIT_TOPIC = bridgeInterface.getEvent("ERC20DepositInitiated").topicHash.toLowerCase();
const OPTIMISM_ETH_WITHDRAW_TOPIC = bridgeInterface.getEvent("ETHWithdrawalFinalized").topicHash.toLowerCase();
const OPTIMISM_ERC20_WITHDRAW_TOPIC = bridgeInterface.getEvent("ERC20WithdrawalFinalized").topicHash.toLowerCase();

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function parseLogIndex(rawIndex) {
  if (rawIndex == null) return null;
  if (typeof rawIndex === "number") return Number.isFinite(rawIndex) ? rawIndex : null;
  if (typeof rawIndex === "string") {
    const parsed = rawIndex.startsWith("0x") ? parseInt(rawIndex, 16) : parseInt(rawIndex, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rawLogEvidence(log, txHash) {
  return {
    address: normalizeAddress(log.address),
    topics: Array.isArray(log.topics) ? log.topics : [],
    data: log.data ?? "0x",
    logIndex: parseLogIndex(log.logIndex),
    transactionHash: log.transactionHash || txHash || null,
  };
}

// ---------------------------------------------------------------------------
// 1. Protocol / Router / Contract Identification
// ---------------------------------------------------------------------------

/**
 * Identifies the DeFi protocol using multi-signal corroboration:
 * - entity/metadata labels (MetaSleuth / user labels)
 * - decoded event topic signatures
 * - transaction destination & contract interactions
 * - function selector
 *
 * Returns { protocol, isIdentified, confidence, category, evidence }
 * Unknown protocols remain null rather than guessed.
 */
export function identifyDeFiProtocol({
  toAddress = null,
  logs = [],
  selector = null,
  label = null,
} = {}) {
  const normTo = normalizeAddress(toAddress);
  const topics = new Set(
    (Array.isArray(logs) ? logs : [])
      .map((l) => String(l.topics?.[0] || "").toLowerCase())
      .filter(Boolean)
  );

  const entityText = [
    label?.main_entity,
    label?.main_entity_info?.entity,
    label?.name_tag,
    label?.entity,
    label?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 1. WETH / Wrapper detection
  if (normTo === WETH_MAINNET || topics.has(WETH_DEPOSIT_TOPIC) || topics.has(WETH_WITHDRAWAL_TOPIC)) {
    return {
      protocol: "WETH9",
      isIdentified: true,
      confidence: "HIGH",
      category: "WRAPPER",
      evidence: { contract: normTo || WETH_MAINNET, wrapperEvent: true },
    };
  }

  // 2. Flash Loan protocol detection
  if (topics.has(AAVE_V3_FLASH_TOPIC)) {
    return {
      protocol: "Aave_V3",
      isIdentified: true,
      confidence: "HIGH",
      category: "LENDING_FLASH_LOAN",
      evidence: { topic: AAVE_V3_FLASH_TOPIC },
    };
  }
  if (topics.has(AAVE_V2_FLASH_TOPIC)) {
    return {
      protocol: "Aave_V2",
      isIdentified: true,
      confidence: "HIGH",
      category: "LENDING_FLASH_LOAN",
      evidence: { topic: AAVE_V2_FLASH_TOPIC },
    };
  }
  if (topics.has(BALANCER_FLASH_TOPIC)) {
    return {
      protocol: "Balancer_V2",
      isIdentified: true,
      confidence: "HIGH",
      category: "DEX_FLASH_LOAN",
      evidence: { topic: BALANCER_FLASH_TOPIC },
    };
  }
  if (topics.has(UNISWAP_V3_FLASH_TOPIC)) {
    return {
      protocol: "Uniswap_V3",
      isIdentified: true,
      confidence: "HIGH",
      category: "AMM_FLASH_LOAN",
      evidence: { topic: UNISWAP_V3_FLASH_TOPIC },
    };
  }

  // 3. Staking protocol detection
  if (topics.has(LIDO_SUBMITTED_TOPIC) || entityText.includes("lido")) {
    return {
      protocol: "Lido",
      isIdentified: true,
      confidence: "HIGH",
      category: "LIQUID_STAKING",
      evidence: { lidoEventOrLabel: true },
    };
  }
  if (entityText.includes("rocket pool") || entityText.includes("rocketpool")) {
    return {
      protocol: "Rocket_Pool",
      isIdentified: true,
      confidence: "HIGH",
      category: "LIQUID_STAKING",
      evidence: { entityText },
    };
  }
  if (topics.has(ERC4626_DEPOSIT_TOPIC) || topics.has(ERC4626_WITHDRAW_TOPIC)) {
    return {
      protocol: entityText ? label?.main_entity || label?.name_tag : "ERC4626_Vault",
      isIdentified: true,
      confidence: entityText ? "HIGH" : "MEDIUM",
      category: "VAULT_STAKING",
      evidence: { erc4626Events: true },
    };
  }
  if (topics.has(STAKED_GENERIC_TOPIC) || topics.has(WITHDRAWN_GENERIC_TOPIC)) {
    return {
      protocol: entityText ? label?.main_entity || label?.name_tag : "StakingRewards",
      isIdentified: true,
      confidence: entityText ? "HIGH" : "MEDIUM",
      category: "STAKING",
      evidence: { stakingRewardsEvent: true },
    };
  }

  // 4. Bridge protocol detection
  if (topics.has(WORMHOLE_LOG_TOPIC) || entityText.includes("wormhole")) {
    return {
      protocol: "Wormhole",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { wormholeEventOrLabel: true },
    };
  }
  if (topics.has(ACROSS_FUNDS_DEPOSITED_TOPIC) || entityText.includes("across")) {
    return {
      protocol: "Across",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { acrossEvent: true },
    };
  }
  if (topics.has(HOP_TRANSFER_SENT_TOPIC) || entityText.includes("hop protocol") || entityText.includes("hop bridge")) {
    return {
      protocol: "Hop_Protocol",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { hopEvent: true },
    };
  }
  if (
    topics.has(OPTIMISM_ETH_DEPOSIT_TOPIC) ||
    topics.has(OPTIMISM_ERC20_DEPOSIT_TOPIC) ||
    topics.has(OPTIMISM_ETH_WITHDRAW_TOPIC) ||
    topics.has(OPTIMISM_ERC20_WITHDRAW_TOPIC) ||
    entityText.includes("optimism portal") ||
    entityText.includes("base portal") ||
    entityText.includes("l1standardbridge")
  ) {
    return {
      protocol: entityText.includes("base") ? "Base_Bridge" : "Optimism_Bridge",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { standardBridgeEvent: true },
    };
  }
  if (entityText.includes("stargate") || entityText.includes("layerzero")) {
    return {
      protocol: "Stargate",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { entityText },
    };
  }
  if (entityText.includes("arbitrum") && (entityText.includes("bridge") || entityText.includes("inbox"))) {
    return {
      protocol: "Arbitrum_Bridge",
      isIdentified: true,
      confidence: "HIGH",
      category: "BRIDGE",
      evidence: { entityText },
    };
  }
  if (entityText.includes("bridge") || entityText.includes("cbridge") || entityText.includes("portal")) {
    return {
      protocol: label?.main_entity || label?.name_tag || "CrossChainBridge",
      isIdentified: true,
      confidence: "MEDIUM",
      category: "BRIDGE",
      evidence: { entityText },
    };
  }

  // 5. DEX protocols from entity labels
  if (entityText.includes("uniswap")) {
    return {
      protocol: "Uniswap",
      isIdentified: true,
      confidence: "HIGH",
      category: "DEX",
      evidence: { entityText },
    };
  }
  if (entityText.includes("sushiswap") || entityText.includes("sushi")) {
    return {
      protocol: "SushiSwap",
      isIdentified: true,
      confidence: "HIGH",
      category: "DEX",
      evidence: { entityText },
    };
  }
  if (entityText.includes("curve")) {
    return {
      protocol: "Curve_Finance",
      isIdentified: true,
      confidence: "HIGH",
      category: "DEX",
      evidence: { entityText },
    };
  }

  // Fallback: Label entity exists but not a known specific DeFi subtype
  if (label?.main_entity || label?.name_tag) {
    return {
      protocol: label.main_entity || label.name_tag,
      isIdentified: true,
      confidence: "MEDIUM",
      category: "CONTRACT",
      evidence: { labelText: entityText },
    };
  }

  // Unknown protocol — do NOT guess
  return {
    protocol: null,
    isIdentified: false,
    confidence: "LOW",
    category: "UNKNOWN",
    evidence: { to: normTo, selector },
  };
}

// ---------------------------------------------------------------------------
// 2. Wrap / Unwrap Reconstruction (ETH <-> WETH)
// ---------------------------------------------------------------------------

/**
 * Reconstructs native-token <-> wrapped-token conversion from on-chain evidence:
 * - Wrap: ETH sent out from wallet, WETH received into wallet, Deposit event in receipt.
 * - Unwrap: WETH sent out from wallet, ETH received into wallet, Withdrawal event in receipt.
 */
export function reconstructWrapUnwrap({
  txHash,
  txRecord = null,
  outgoing = [],
  incoming = [],
  rootAddress,
  protocolInfo = null,
} = {}) {
  const receipt = txRecord?.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const normRoot = normalizeAddress(rootAddress);

  const hasDepositLog = logs.some((l) => {
    const topic0 = String(l.topics?.[0] || "").toLowerCase();
    if (topic0 !== WETH_DEPOSIT_TOPIC) return false;
    const addr = normalizeAddress(l.address);
    return addr === WETH_MAINNET || !addr;
  });

  const hasWithdrawalLog = logs.some((l) => {
    const topic0 = String(l.topics?.[0] || "").toLowerCase();
    if (topic0 !== WETH_WITHDRAWAL_TOPIC) return false;
    const addr = normalizeAddress(l.address);
    return addr === WETH_MAINNET || !addr;
  });

  const ethOut = outgoing.find((m) => m.asset === "ETH");
  const wethIn = incoming.find((m) => m.asset === "WETH");
  const wethOut = outgoing.find((m) => m.asset === "WETH");
  const ethIn = incoming.find((m) => m.asset === "ETH");

  const isWrap = Boolean((ethOut && wethIn) || (ethOut && hasDepositLog) || (wethIn && hasDepositLog));
  const isUnwrap = Boolean((wethOut && ethIn) || (wethOut && hasWithdrawalLog) || (ethIn && hasWithdrawalLog));

  if (!isWrap && !isUnwrap) return null;

  const kind = isWrap ? "WRAP" : "UNWRAP";
  const verifiedByReceipt = isWrap ? hasDepositLog : hasWithdrawalLog;
  const relevantMovements = [...outgoing, ...incoming];
  const sourceTransferRefs = [...new Set(relevantMovements.flatMap((m) => m.transferRefs || []))];

  const inputAssets = isWrap
    ? [{ asset: "ETH", tokenAddress: null, amount: ethOut?.outgoingAmount ?? wethIn?.incomingAmount ?? null }]
    : [{ asset: "WETH", tokenAddress: WETH_MAINNET, amount: wethOut?.outgoingAmount ?? ethIn?.incomingAmount ?? null }];

  const outputAssets = isWrap
    ? [{ asset: "WETH", tokenAddress: WETH_MAINNET, amount: wethIn?.incomingAmount ?? ethOut?.outgoingAmount ?? null }]
    : [{ asset: "ETH", tokenAddress: null, amount: ethIn?.incomingAmount ?? wethOut?.outgoingAmount ?? null }];

  const decodedEvents = logs
    .filter((l) => {
      const topic0 = String(l.topics?.[0] || "").toLowerCase();
      return topic0 === WETH_DEPOSIT_TOPIC || topic0 === WETH_WITHDRAWAL_TOPIC;
    })
    .map((l) => rawLogEvidence(l, txHash));

  const score = verifiedByReceipt ? 95 : 75;
  const confidence = {
    score,
    breakdown: {
      wrapperLogCorroborated: verifiedByReceipt ? 50 : 25,
      symmetricFlow: 35,
      executionSuccess: receipt?.status === "0x1" ? 10 : 0,
    },
  };

  return {
    id: `${kind}:${txHash}`,
    kind,
    protocol: "WETH9",
    contractAddress: WETH_MAINNET,
    txHash,
    blockNumber: relevantMovements[0]?.blockNumber || null,
    timestamp: relevantMovements[0]?.timestamp || null,
    inputAssets,
    outputAssets,
    sourceTransferRefs,
    decodedEvents,
    rawEvidence: decodedEvents,
    confidence,
    reviewRequired: !verifiedByReceipt,
    reconstructionStatus: verifiedByReceipt ? "VERIFIED" : "PARTIAL",
    reason: verifiedByReceipt
      ? `Verified native ${isWrap ? "ETH wrapping into WETH" : "WETH unwrapping into ETH"} via contract event.`
      : `Wrap/unwrap movements detected, but receipt wrapper event log was omitted or unconfirmed.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Flash Loan Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstructs flash loan borrowing/repayment activity from receipt logs.
 * A flash loan MUST NOT be treated as a regular taxable buy/sell.
 */
export function reconstructFlashLoan({
  txHash,
  txRecord = null,
  movements = [],
  protocolInfo = null,
} = {}) {
  const receipt = txRecord?.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];

  const flashLogs = logs.filter((l) => {
    const topic0 = String(l.topics?.[0] || "").toLowerCase();
    return (
      topic0 === AAVE_V3_FLASH_TOPIC ||
      topic0 === AAVE_V2_FLASH_TOPIC ||
      topic0 === BALANCER_FLASH_TOPIC ||
      topic0 === UNISWAP_V3_FLASH_TOPIC
    );
  });

  if (!flashLogs.length) return null;

  const firstLog = flashLogs[0];
  const topic0 = String(firstLog.topics?.[0] || "").toLowerCase();
  let protocol = "Unknown_Lending_Pool";
  let borrowedAsset = null;
  let borrowedAmount = null;
  let feeAmount = null;

  try {
    if (topic0 === AAVE_V3_FLASH_TOPIC || topic0 === AAVE_V2_FLASH_TOPIC) {
      protocol = topic0 === AAVE_V3_FLASH_TOPIC ? "Aave_V3" : "Aave_V2";
      // asset is indexed topic 3 on V2, topic 2 on V3
      const parsed = flashLoanInterface.parseLog({ topics: firstLog.topics, data: firstLog.data });
      if (parsed) {
        borrowedAsset = parsed.args.asset ? normalizeAddress(parsed.args.asset) : null;
        borrowedAmount = parsed.args.amount ? parsed.args.amount.toString() : null;
        feeAmount = parsed.args.premium ? parsed.args.premium.toString() : null;
      }
    } else if (topic0 === BALANCER_FLASH_TOPIC) {
      protocol = "Balancer_V2";
      const parsed = flashLoanInterface.parseLog({ topics: firstLog.topics, data: firstLog.data });
      if (parsed) {
        borrowedAsset = parsed.args.token ? normalizeAddress(parsed.args.token) : null;
        borrowedAmount = parsed.args.amount ? parsed.args.amount.toString() : null;
        feeAmount = parsed.args.feeAmount ? parsed.args.feeAmount.toString() : null;
      }
    } else if (topic0 === UNISWAP_V3_FLASH_TOPIC) {
      protocol = "Uniswap_V3";
      const parsed = flashLoanInterface.parseLog({ topics: firstLog.topics, data: firstLog.data });
      if (parsed) {
        borrowedAmount = parsed.args.amount0 ? parsed.args.amount0.toString() : null;
        feeAmount = parsed.args.paid0 ? parsed.args.paid0.toString() : null;
      }
    }
  } catch {
    // Keep decoding robust if arg layout differs
  }

  const sourceTransferRefs = [...new Set(movements.flatMap((m) => m.transferRefs || []))];
  const poolContract = normalizeAddress(firstLog.address);

  const confidence = {
    score: 95,
    breakdown: {
      verifiedFlashLoanLog: 50,
      protocolIdentified: 35,
      executionSuccess: receipt?.status === "0x1" ? 10 : 0,
    },
  };

  return {
    id: `FLASH_LOAN:${txHash}`,
    kind: "FLASH_LOAN",
    protocol,
    contractAddress: poolContract,
    txHash,
    blockNumber: movements[0]?.blockNumber || null,
    timestamp: movements[0]?.timestamp || null,
    inputAssets: borrowedAsset || borrowedAmount ? [{ asset: borrowedAsset || "ASSET", amount: borrowedAmount }] : [],
    outputAssets: borrowedAsset || borrowedAmount ? [{ asset: borrowedAsset || "ASSET", amount: borrowedAmount, fee: feeAmount }] : [],
    borrowedAssets: borrowedAsset || borrowedAmount ? [{ asset: borrowedAsset, amount: borrowedAmount }] : [],
    repaymentAssets: borrowedAsset || borrowedAmount ? [{ asset: borrowedAsset, amount: borrowedAmount, fee: feeAmount }] : [],
    sourceTransferRefs,
    decodedEvents: flashLogs.map((l) => rawLogEvidence(l, txHash)),
    rawEvidence: flashLogs.map((l) => rawLogEvidence(l, txHash)),
    confidence,
    reviewRequired: false,
    reconstructionStatus: "VERIFIED",
    reason: `Verified ${protocol} flash loan transaction. Intra-block borrowed liquidity is not a taxable disposition.`,
  };
}

// ---------------------------------------------------------------------------
// 4. Staking / Unstaking Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstructs Staking and Unstaking from contract events.
 * Does NOT guess staking merely because tokens moved to a contract.
 */
export function reconstructStaking({
  txHash,
  txRecord = null,
  outgoing = [],
  incoming = [],
  protocolInfo = null,
} = {}) {
  const receipt = txRecord?.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];

  const stakingLogs = logs.filter((l) => {
    const topic0 = String(l.topics?.[0] || "").toLowerCase();
    return (
      topic0 === LIDO_SUBMITTED_TOPIC ||
      topic0 === ERC4626_DEPOSIT_TOPIC ||
      topic0 === ERC4626_WITHDRAW_TOPIC ||
      topic0 === STAKED_GENERIC_TOPIC ||
      topic0 === WITHDRAWN_GENERIC_TOPIC
    );
  });

  // Only proceed if corroborating staking logs exist OR protocol is verified staking
  const isStakingProtocol =
    protocolInfo?.category === "LIQUID_STAKING" ||
    protocolInfo?.category === "VAULT_STAKING" ||
    protocolInfo?.category === "STAKING";

  if (!stakingLogs.length && !isStakingProtocol) return null;

  // Determine whether it is STAKE or UNSTAKE
  let isStake = false;
  let isUnstake = false;

  for (const log of stakingLogs) {
    const topic0 = String(log.topics?.[0] || "").toLowerCase();
    if (topic0 === LIDO_SUBMITTED_TOPIC || topic0 === ERC4626_DEPOSIT_TOPIC || topic0 === STAKED_GENERIC_TOPIC) {
      isStake = true;
    }
    if (topic0 === ERC4626_WITHDRAW_TOPIC || topic0 === WITHDRAWN_GENERIC_TOPIC) {
      isUnstake = true;
    }
  }

  if (!isStake && !isUnstake) {
    if (outgoing.length > 0 && !incoming.length) isStake = true;
    else if (incoming.length > 0 && !outgoing.length) isUnstake = true;
  }

  const kind = isStake ? "STAKE" : "UNSTAKE";
  const protocol = protocolInfo?.protocol || (stakingLogs.length ? "Staking_Contract" : "Unknown_Staking");
  const contractAddress = normalizeAddress(stakingLogs[0]?.address || txRecord?.transaction?.to);

  const inputAssets = isStake
    ? outgoing.map((m) => ({ asset: m.asset, amount: m.outgoingAmount, tokenAddress: m.tokenAddress }))
    : [];
  const outputAssets = isUnstake
    ? incoming.map((m) => ({ asset: m.asset, amount: m.incomingAmount, tokenAddress: m.tokenAddress }))
    : incoming.map((m) => ({ asset: m.asset, amount: m.incomingAmount, tokenAddress: m.tokenAddress }));

  const relevantMovements = [...outgoing, ...incoming];
  const sourceTransferRefs = [...new Set(relevantMovements.flatMap((m) => m.transferRefs || []))];

  const hasEventEvidence = stakingLogs.length > 0;
  const score = hasEventEvidence ? 90 : 65;
  const confidence = {
    score,
    breakdown: {
      stakingEventVerified: hasEventEvidence ? 45 : 15,
      protocolIdentified: protocolInfo?.isIdentified ? 35 : 10,
      executionSuccess: receipt?.status === "0x1" ? 10 : 0,
    },
  };

  return {
    id: `${kind}:${txHash}`,
    kind,
    protocol,
    contractAddress,
    txHash,
    blockNumber: relevantMovements[0]?.blockNumber || null,
    timestamp: relevantMovements[0]?.timestamp || null,
    inputAssets,
    outputAssets,
    sourceTransferRefs,
    decodedEvents: stakingLogs.map((l) => rawLogEvidence(l, txHash)),
    rawEvidence: stakingLogs.map((l) => rawLogEvidence(l, txHash)),
    confidence,
    reviewRequired: !hasEventEvidence,
    reconstructionStatus: hasEventEvidence ? "VERIFIED" : "PARTIAL",
    reason: hasEventEvidence
      ? `Verified ${protocol} ${kind.toLowerCase()} activity via contract receipt logs.`
      : `Staking activity indicated by protocol label; receipt event log was unverified.`,
  };
}

// ---------------------------------------------------------------------------
// 5. Bridge Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstructs cross-chain bridge transactions from logs/metadata.
 * Do not automatically classify every contract transfer as a bridge.
 * If evidence is insufficient, mark UNKNOWN_DEFI + reviewRequired = true.
 */
export function reconstructBridge({
  txHash,
  txRecord = null,
  outgoing = [],
  incoming = [],
  protocolInfo = null,
} = {}) {
  const receipt = txRecord?.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];

  const bridgeLogs = logs.filter((l) => {
    const topic0 = String(l.topics?.[0] || "").toLowerCase();
    return (
      topic0 === WORMHOLE_LOG_TOPIC ||
      topic0 === ACROSS_FUNDS_DEPOSITED_TOPIC ||
      topic0 === HOP_TRANSFER_SENT_TOPIC ||
      topic0 === OPTIMISM_ETH_DEPOSIT_TOPIC ||
      topic0 === OPTIMISM_ERC20_DEPOSIT_TOPIC ||
      topic0 === OPTIMISM_ETH_WITHDRAW_TOPIC ||
      topic0 === OPTIMISM_ERC20_WITHDRAW_TOPIC
    );
  });

  const isBridgeProtocol = protocolInfo?.category === "BRIDGE";
  if (!bridgeLogs.length && !isBridgeProtocol) return null;

  const relevantMovements = [...outgoing, ...incoming];
  const sourceTransferRefs = [...new Set(relevantMovements.flatMap((m) => m.transferRefs || []))];

  // Try extracting destination chain/recipient when possible
  let destinationChain = null;
  let bridgeRecipient = null;

  for (const log of bridgeLogs) {
    const topic0 = String(log.topics?.[0] || "").toLowerCase();
    try {
      if (topic0 === ACROSS_FUNDS_DEPOSITED_TOPIC) {
        const parsed = bridgeInterface.parseLog({ topics: log.topics, data: log.data });
        if (parsed) {
          destinationChain = parsed.args.destinationChainId ? parsed.args.destinationChainId.toString() : null;
          bridgeRecipient = parsed.args.recipient ? normalizeAddress(parsed.args.recipient) : null;
        }
      } else if (topic0 === HOP_TRANSFER_SENT_TOPIC) {
        const parsed = bridgeInterface.parseLog({ topics: log.topics, data: log.data });
        if (parsed) {
          destinationChain = parsed.args.chainId ? parsed.args.chainId.toString() : null;
          bridgeRecipient = parsed.args.recipient ? normalizeAddress(parsed.args.recipient) : null;
        }
      }
    } catch {
      // Fallback gracefully
    }
  }

  const hasEventEvidence = bridgeLogs.length > 0;
  const protocol = protocolInfo?.protocol || (hasEventEvidence ? "CrossChainBridge" : "Unknown_Bridge");
  const contractAddress = normalizeAddress(bridgeLogs[0]?.address || txRecord?.transaction?.to);

  const inputAssets = outgoing.map((m) => ({
    asset: m.asset,
    amount: m.outgoingAmount,
    tokenAddress: m.tokenAddress,
  }));
  const outputAssets = incoming.map((m) => ({
    asset: m.asset,
    amount: m.incomingAmount,
    tokenAddress: m.tokenAddress,
  }));

  const score = hasEventEvidence ? 85 : 60;
  const confidence = {
    score,
    breakdown: {
      bridgeEventVerified: hasEventEvidence ? 45 : 15,
      protocolIdentified: protocolInfo?.isIdentified ? 30 : 15,
      executionSuccess: receipt?.status === "0x1" ? 10 : 0,
    },
  };

  return {
    id: `BRIDGE:${txHash}`,
    kind: "BRIDGE",
    protocol,
    contractAddress,
    txHash,
    blockNumber: relevantMovements[0]?.blockNumber || null,
    timestamp: relevantMovements[0]?.timestamp || null,
    destinationChain,
    recipient: bridgeRecipient,
    inputAssets,
    outputAssets,
    sourceTransferRefs,
    decodedEvents: bridgeLogs.map((l) => rawLogEvidence(l, txHash)),
    rawEvidence: bridgeLogs.map((l) => rawLogEvidence(l, txHash)),
    confidence,
    reviewRequired: !hasEventEvidence || (!inputAssets.length && !outputAssets.length),
    reconstructionStatus: hasEventEvidence ? "VERIFIED" : "PARTIAL",
    reason: hasEventEvidence
      ? `Verified ${protocol} cross-chain bridge transaction${destinationChain ? ` to chain ${destinationChain}` : ""}.`
      : `Bridge interaction indicated by entity label, but bridge event logs were unverified.`,
  };
}

// ---------------------------------------------------------------------------
// 6. Unknown DeFi Reconstruction
// ---------------------------------------------------------------------------

/**
 * Emits UNKNOWN_DEFI when a transaction involves a contract/DeFi interaction
 * but cannot be verified into an economic category.
 * NEVER force an uncertain transaction into DEX_SWAP, BRIDGE, STAKE, etc.
 */
export function reconstructUnknownDefi({
  txHash,
  txRecord = null,
  movements = [],
  protocolInfo = null,
  reason = null,
} = {}) {
  const receipt = txRecord?.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const sourceTransferRefs = [...new Set(movements.flatMap((m) => m.transferRefs || []))];
  const contractAddress = normalizeAddress(txRecord?.transaction?.to);

  const outgoing = movements.filter((m) => m.outgoingAmount > 0);
  const incoming = movements.filter((m) => m.incomingAmount > 0);

  const uninterpretedLogs = logs.map((l) => rawLogEvidence(l, txHash));

  return {
    id: `UNKNOWN_DEFI:${txHash}`,
    kind: "UNKNOWN_DEFI",
    protocol: protocolInfo?.protocol || null,
    contractAddress,
    txHash,
    blockNumber: movements[0]?.blockNumber || null,
    timestamp: movements[0]?.timestamp || null,
    inputAssets: outgoing.map((m) => ({ asset: m.asset, amount: m.outgoingAmount, tokenAddress: m.tokenAddress })),
    outputAssets: incoming.map((m) => ({ asset: m.asset, amount: m.incomingAmount, tokenAddress: m.tokenAddress })),
    sourceTransferRefs,
    decodedEvents: [],
    rawEvidence: uninterpretedLogs,
    uninterpretedLogs,
    confidence: {
      score: 15,
      breakdown: { contractInteractionObserved: 10, receiptConfirmed: receipt?.status === "0x1" ? 5 : 0 },
    },
    reviewRequired: true,
    reconstructionStatus: "REVIEW_REQUIRED",
    reason:
      reason ||
      "DeFi contract interaction observed, but receipt logs lack verified event evidence to classify economic disposition.",
  };
}

// ---------------------------------------------------------------------------
// 7. Master DeFi Reconstructor
// ---------------------------------------------------------------------------

/**
 * Reconstructs non-AMM DeFi activities (Wrap, Flash Loan, Staking, Bridge, Unknown DeFi)
 * for a single transaction hash.
 * Returns null if the transaction is not a recognized DeFi contract interaction.
 */
export function reconstructDeFiActivity({
  txHash,
  movements = [],
  txRecord = null,
  label = null,
  rootAddress = null,
} = {}) {
  if (!txRecord?.transaction) return null;
  const tx = txRecord.transaction;
  const receipt = txRecord.receipt;
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const selector = tx?.input && tx.input !== "0x" ? tx.input.slice(0, 10).toLowerCase() : null;

  // Protocol identification
  const protocolInfo = identifyDeFiProtocol({
    toAddress: tx.to,
    logs,
    selector,
    label,
  });

  const outgoing = movements.filter((m) => m.outgoingAmount > 0);
  const incoming = movements.filter((m) => m.incomingAmount > 0);

  // 1. Flash Loan check first (so large intra-block transfers are not confused with swaps)
  const flashLoan = reconstructFlashLoan({
    txHash,
    txRecord,
    movements,
    protocolInfo,
  });
  if (flashLoan) return flashLoan;

  // 2. Wrap / Unwrap check
  const wrapUnwrap = reconstructWrapUnwrap({
    txHash,
    txRecord,
    outgoing,
    incoming,
    rootAddress,
    protocolInfo,
  });
  if (wrapUnwrap) return wrapUnwrap;

  // 3. Staking / Unstaking check
  const staking = reconstructStaking({
    txHash,
    txRecord,
    outgoing,
    incoming,
    protocolInfo,
  });
  if (staking) return staking;

  // 4. Bridge check
  const bridge = reconstructBridge({
    txHash,
    txRecord,
    outgoing,
    incoming,
    protocolInfo,
  });
  if (bridge) return bridge;

  // 5. Contract interaction with unverified logs or opposing flows that wasn't an AMM swap
  const isContractCall = Boolean(tx.to && tx.input && tx.input !== "0x");
  const hasTransfers = movements.length > 0;
  const hasLogs = logs.length > 0;

  // Plain ERC-20 transfer(to, amount) calls with only standard Transfer logs and no identified DeFi protocol
  // are ordinary wallet transfers and should not be trapped as UNKNOWN_DEFI.
  const isPlainErc20Transfer =
    (selector === "0xa9059cbb" || selector === "0x23b872dd") &&
    logs.length > 0 &&
    logs.every((l) => String(l.topics?.[0] || "").toLowerCase() === TRANSFER_TOPIC);

  if (isPlainErc20Transfer && !protocolInfo?.isIdentified) {
    return null;
  }

  // AMM Swap / Liquidity transactions are strictly handled by existing AMM reconstruction
  const AMM_TOPICS = new Set([
    "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", // V2 Swap
    "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1", // V2 Sync
    "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef163b4905e0e5647d", // V2 Mint
    "0xdccd414f0b90793b50c6d7ea6e003d52363cb0494f805c693c04973b63477a7e", // V2 Burn
    "0xc42079f94a6350d7e6235f29174924f9d5fb2ce002419f8ba8ff92956fece5ec", // V3 Swap
  ]);
  const hasAmmEvents = logs.some((l) => AMM_TOPICS.has(String(l.topics?.[0] || "").toLowerCase()));
  if (hasAmmEvents) {
    return null;
  }

  if (isContractCall && (hasLogs || hasTransfers)) {
    return reconstructUnknownDefi({
      txHash,
      txRecord,
      movements,
      protocolInfo,
      reason: protocolInfo?.isIdentified
        ? `Observed ${protocolInfo.protocol} contract interaction, but event logs were insufficient to reconstruct a specific economic action.`
        : "Unidentified contract interaction with on-chain transfers; manual review required to determine taxability.",
    });
  }

  return null;
}
