import { Interface } from "ethers";

const eventDefinitions = new Map();
const transferInterface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const transferTopic = transferInterface.getEvent("Transfer").topicHash.toLowerCase();

function parseLogIndex(rawIndex) {
  if (rawIndex == null) return null;
  if (typeof rawIndex === "number") return Number.isFinite(rawIndex) ? rawIndex : null;
  if (typeof rawIndex === "string") {
    const parsed = rawIndex.startsWith("0x") ? parseInt(rawIndex, 16) : parseInt(rawIndex, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAddress(addr) {
  return typeof addr === "string" ? addr.toLowerCase() : null;
}

function rawLogEvidence(log, txHash) {
  return {
    address: log.address ?? null,
    topics: log.topics,
    data: log.data ?? "0x",
    logIndex: log.logIndex ?? null,
    transactionHash: log.transactionHash || txHash || null,
  };
}

function toSerializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSerializable(item)]));
  }
  return value;
}

/**
 * Adds an ABI-backed event interpretation without coupling receipt handling to
 * a contract address, transaction selector, or protocol address list.
 */
export function registerAmmEventDefinition({ abi, eventName, protocol, eventType, mapArgs }) {
  const eventInterface = new Interface(abi);
  const event = eventInterface.getEvent(eventName);
  if (!event) throw new Error(`Unable to resolve event definition: ${eventName}`);
  eventDefinitions.set(event.topicHash.toLowerCase(), {
    eventInterface,
    eventName,
    protocol,
    eventType,
    mapArgs,
  });
}

const v2Abi = [
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
];
const v3Abi = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

registerAmmEventDefinition({
  abi: v2Abi,
  eventName: "Swap",
  protocol: "Uniswap_V2",
  eventType: "Swap",
  mapArgs: (args) => ({
    sender: normalizeAddress(args.sender),
    to: normalizeAddress(args.to),
    tokenAmounts: {
      amount0In: args.amount0In.toString(),
      amount1In: args.amount1In.toString(),
      amount0Out: args.amount0Out.toString(),
      amount1Out: args.amount1Out.toString(),
    },
  }),
});
registerAmmEventDefinition({
  abi: v2Abi,
  eventName: "Sync",
  protocol: "Uniswap_V2",
  eventType: "Sync",
  mapArgs: (args) => ({
    reserveChanges: {
      reserve0: args.reserve0.toString(),
      reserve1: args.reserve1.toString(),
    },
  }),
});
registerAmmEventDefinition({
  abi: v2Abi,
  eventName: "Mint",
  protocol: "Uniswap_V2",
  eventType: "Mint",
  mapArgs: (args) => ({
    sender: normalizeAddress(args.sender),
    tokenAmounts: { amount0: args.amount0.toString(), amount1: args.amount1.toString() },
  }),
});
registerAmmEventDefinition({
  abi: v2Abi,
  eventName: "Burn",
  protocol: "Uniswap_V2",
  eventType: "Burn",
  mapArgs: (args) => ({
    sender: normalizeAddress(args.sender),
    to: normalizeAddress(args.to),
    tokenAmounts: { amount0: args.amount0.toString(), amount1: args.amount1.toString() },
  }),
});
registerAmmEventDefinition({
  abi: v3Abi,
  eventName: "Swap",
  protocol: "Uniswap_V3",
  eventType: "Swap",
  mapArgs: (args) => ({
    sender: normalizeAddress(args.sender),
    recipient: normalizeAddress(args.recipient),
    tokenAmounts: { amount0: args.amount0.toString(), amount1: args.amount1.toString() },
    sqrtPriceX96: args.sqrtPriceX96.toString(),
    liquidity: args.liquidity.toString(),
    tick: Number(args.tick),
  }),
});

/**
 * Safely decodes a single EVM receipt log using registered event definitions.
 * Unknown signatures and malformed data remain evidence, never guesses.
 */
export function decodeAmmLog(log, txHash = null) {
  if (!log || typeof log !== "object") return null;
  if (!Array.isArray(log.topics) || log.topics.length === 0) return null;

  const topic0 = String(log.topics[0] || "").toLowerCase();
  const hash = log.transactionHash || txHash || null;
  const logIndex = parseLogIndex(log.logIndex);
  const rawLog = rawLogEvidence(log, txHash);
  const definition = eventDefinitions.get(topic0);

  if (!definition) {
    return {
      protocol: null,
      eventType: "UNKNOWN",
      interpretation: "UNINTERPRETED_EVENT_SIGNATURE",
      poolAddress: normalizeAddress(log.address),
      rawLog,
      txHash: hash,
      logIndex,
    };
  }

  try {
    const parsed = definition.eventInterface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) throw new Error("Event signature did not resolve");
    return {
      protocol: definition.protocol,
      eventType: definition.eventType,
      interpretation: "VERIFIED_AMM_EVENT",
      poolAddress: normalizeAddress(log.address),
      ...toSerializable(definition.mapArgs(parsed.args)),
      rawLog,
      txHash: hash,
      logIndex,
    };
  } catch {
    return {
      protocol: null,
      eventType: "UNKNOWN",
      interpretation: "MALFORMED_LOG_DATA",
      poolAddress: normalizeAddress(log.address),
      rawLog,
      txHash: hash,
      logIndex,
    };
  }
}

/**
 * Decodes all logs in a transaction receipt into verified AMM events and uninterpreted logs.
 * Returns { decodedEvents, uninterpretedLogs, hasAmmSwap, primaryPoolAddress, allPoolAddresses }.
 */
export function decodeReceiptAmmEvents(logs, txHash = null) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      decodedEvents: [],
      uninterpretedLogs: [],
      hasAmmSwap: false,
      primaryPoolAddress: null,
      allPoolAddresses: [],
    };
  }

  const decodedEvents = [];
  const uninterpretedLogs = [];

  for (const log of logs) {
    const parsed = decodeAmmLog(log, txHash);
    if (!parsed) continue;
    if (parsed.interpretation === "VERIFIED_AMM_EVENT") {
      decodedEvents.push(parsed);
    } else {
      uninterpretedLogs.push(parsed);
    }
  }

  const hasAmmSwap = decodedEvents.some((e) => e.eventType === "Swap");
  const allPoolAddresses = [...new Set(decodedEvents.map((e) => e.poolAddress).filter(Boolean))];
  const primaryPoolAddress = allPoolAddresses[0] || null;

  return {
    decodedEvents,
    uninterpretedLogs,
    hasAmmSwap,
    primaryPoolAddress,
    allPoolAddresses,
  };
}

function decodeTransferLog(log, txHash = null) {
  if (!log || typeof log !== "object" || !Array.isArray(log.topics)) return null;
  if (String(log.topics[0] || "").toLowerCase() !== transferTopic) return null;
  try {
    const parsed = transferInterface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    return {
      tokenAddress: normalizeAddress(log.address),
      from: normalizeAddress(parsed.args.from),
      to: normalizeAddress(parsed.args.to),
      amount: parsed.args.value.toString(),
      logIndex: parseLogIndex(log.logIndex),
      rawLog: rawLogEvidence(log, txHash),
    };
  } catch {
    return null;
  }
}

function nearestSwapIndex(logIndex, swaps) {
  if (logIndex == null || !swaps.length) return -1;
  return swaps.reduce((nearest, swap, index) => {
    const nearestDistance = Math.abs(swaps[nearest].logIndex - logIndex);
    const distance = Math.abs(swap.logIndex - logIndex);
    return distance < nearestDistance ? index : nearest;
  }, 0);
}

function movementToken(movement) {
  return movement?.tokenAddress || movement?.asset || null;
}

function amountsMatch(expectedAmounts, transfers) {
  if (transfers.length !== expectedAmounts.length) return false;
  const expected = [...expectedAmounts].sort();
  const actual = transfers.map((transfer) => transfer.amount).sort();
  return expected.every((amount, index) => amount === actual[index]);
}

/**
 * Interprets pool Mint/Burn events only when receipt Transfer logs corroborate
 * both token amounts. Event fields remain available when token evidence is
 * missing, but the interpretation is explicitly marked incomplete.
 */
export function detectLiquidityActivities({ decodedEvents = [], logs = [] } = {}) {
  return decodedEvents
    .filter((event) => ["Mint", "Burn"].includes(event?.eventType))
    .map((event) => {
      const isAddition = event.eventType === "Mint";
      const expectedAmounts = [
        event.tokenAmounts?.amount0,
        event.tokenAmounts?.amount1,
      ].filter((amount) => amount != null);
      const transfers = (Array.isArray(logs) ? logs : [])
        .map((log) => decodeTransferLog(log, event.txHash))
        .filter((transfer) => transfer && transfer.tokenAddress)
        .filter((transfer) => isAddition
          ? transfer.to === event.poolAddress
          : transfer.from === event.poolAddress);
      const complete = expectedAmounts.length === 2 && amountsMatch(expectedAmounts, transfers);
      const tokenAmounts = complete
        ? transfers.map((transfer) => ({
            tokenAddress: transfer.tokenAddress,
            amount: transfer.amount,
          }))
        : expectedAmounts.map((amount) => ({ tokenAddress: null, amount }));

      return {
        eventType: isAddition ? "LIQUIDITY_ADD" : "LIQUIDITY_REMOVE",
        poolAddress: event.poolAddress,
        providerAddress: isAddition ? event.sender || null : event.to || null,
        tokenAmounts,
        transactionHash: event.txHash || event.rawLog?.transactionHash || null,
        txHash: event.txHash || event.rawLog?.transactionHash || null,
        logIndex: event.logIndex,
        rawEventEvidence: event.rawLog || null,
        rawLog: event.rawLog || null,
        transferEvidence: transfers.map((transfer) => transfer.rawLog),
        interpretation: complete
          ? "VERIFIED_LIQUIDITY_EVENT"
          : "INCOMPLETE_LIQUIDITY_EVENT",
        interpretationStatus: complete
          ? "VERIFIED_LIQUIDITY_EVENT"
          : "INCOMPLETE_LIQUIDITY_EVENT",
      };
    });
}

function normalizedTokenAmounts(amounts = []) {
  return amounts.map((item) => ({
    tokenAddress: normalizeAddress(item?.tokenAddress),
    amount: item?.amount ?? null,
  }));
}

function tokenAmountsEqual(left, right) {
  if (left.length !== right.length || left.some((item) => !item.tokenAddress || item.amount == null)) return false;
  return left.every((item) => right.some((candidate) => (
    candidate.tokenAddress === item.tokenAddress && candidate.amount === item.amount
  )));
}

function tokenAmountsFit(removed, added) {
  if (removed.length !== added.length || removed.some((item) => !item.tokenAddress || item.amount == null)) return false;
  return removed.every((item) => {
    const matching = added.find((candidate) => candidate.tokenAddress === item.tokenAddress);
    if (!matching || matching.amount == null) return false;
    try {
      return BigInt(item.amount) <= BigInt(matching.amount);
    } catch {
      return false;
    }
  });
}

function subtractTokenAmounts(added, removed) {
  return added.map((item) => {
    const matching = removed.find((candidate) => candidate.tokenAddress === item.tokenAddress);
    if (!matching) return { ...item };
    return {
      ...item,
      amount: (BigInt(item.amount) - BigInt(matching.amount)).toString(),
    };
  });
}

function eventEvidence(event) {
  return {
    eventType: event.eventType,
    transactionHash: event.transactionHash || event.txHash || null,
    logIndex: event.logIndex ?? null,
    rawEventEvidence: event.rawEventEvidence || event.rawLog || null,
    transferEvidence: event.transferEvidence || [],
    interpretation: event.interpretationStatus || event.interpretation || "UNKNOWN",
  };
}

/**
 * Links only verified Mint/Burn evidence. There is intentionally no LP token
 * or protocol identifier here; ambiguous candidates remain unmatched.
 */
export function trackLiquidityPositions(liquidityEvents = []) {
  const positions = [];
  const adds = [];

  for (const event of liquidityEvents) {
    const isAdd = event?.eventType === "LIQUIDITY_ADD";
    const isRemove = event?.eventType === "LIQUIDITY_REMOVE";
    if (!isAdd && !isRemove) continue;

    const tokenAmounts = normalizedTokenAmounts(event.tokenAmounts);
    const providerAddress = normalizeAddress(event.providerAddress);
    const evidence = eventEvidence(event);
    const eventKey = `${evidence.transactionHash || "unknown"}:${evidence.logIndex ?? "unknown"}`;

    if (isAdd) {
      const position = {
        positionId: `lp-position:${eventKey}`,
        poolAddress: normalizeAddress(event.poolAddress),
        providerAddress,
        tokenAmountsAdded: tokenAmounts,
        tokenAmountsRemoved: [],
        originatingTransactionHash: evidence.transactionHash,
        removalTransactionHash: null,
        positionStatus: event.interpretationStatus === "VERIFIED_LIQUIDITY_EVENT"
          ? (providerAddress ? "OPEN" : "OPEN_UNOWNED")
          : "INCOMPLETE_EVIDENCE",
        supportingEvidence: { add: evidence, removals: [] },
        _remaining: tokenAmounts,
        _eventKey: eventKey,
      };
      positions.push(position);
      adds.push(position);
      continue;
    }

    const removalAmounts = tokenAmounts;
    const candidates = adds.filter((position) => (
      position.positionStatus === "OPEN" || position.positionStatus === "PARTIALLY_REMOVED"
    ) && position.poolAddress === normalizeAddress(event.poolAddress)
      && providerAddress
      && position.providerAddress === providerAddress
      && event.interpretationStatus === "VERIFIED_LIQUIDITY_EVENT"
      && tokenAmountsFit(removalAmounts, position._remaining)
    );
    const exactCandidates = candidates.filter((position) => tokenAmountsEqual(removalAmounts, position._remaining));
    const matches = exactCandidates.length === 1 ? exactCandidates : candidates.length === 1 ? candidates : [];

    if (matches.length === 1) {
      const position = matches[0];
      position.tokenAmountsRemoved.push(...removalAmounts);
      position._remaining = subtractTokenAmounts(position._remaining, removalAmounts);
      position.removalTransactionHash = evidence.transactionHash;
      position.supportingEvidence.removals.push(evidence);
      position.positionStatus = position._remaining.every((item) => item.amount === "0")
        ? "CLOSED"
        : "PARTIALLY_REMOVED";
      continue;
    }

    positions.push({
      positionId: `lp-removal:${eventKey}`,
      poolAddress: normalizeAddress(event.poolAddress),
      providerAddress,
      tokenAmountsAdded: [],
      tokenAmountsRemoved: removalAmounts,
      originatingTransactionHash: null,
      removalTransactionHash: evidence.transactionHash,
      positionStatus: candidates.length > 1 ? "AMBIGUOUS_MATCH" : "UNMATCHED_REMOVAL",
      supportingEvidence: { add: null, removals: [evidence] },
      _remaining: [],
      _eventKey: eventKey,
    });
  }

  return positions.map(({ _remaining, _eventKey, ...position }) => position);
}

/**
 * Reconstructs an ordered route only when each hop has provable pool-side
 * token movement. Missing or ambiguous evidence is returned, never inferred.
 */
export function reconstructAmmRoute({ decodedEvents = [], logs = [], walletTransfers = {} } = {}) {
  const candidateSwaps = decodedEvents
    .filter((event) => event?.eventType === "Swap" && event?.interpretation === "VERIFIED_AMM_EVENT")
    .filter((event) => event.logIndex != null && event.poolAddress)
    .sort((left, right) => left.logIndex - right.logIndex);
  const transactionHash = candidateSwaps[0]?.rawLog?.transactionHash || candidateSwaps[0]?.txHash || null;
  const swaps = candidateSwaps.filter((event) => {
    const eventHash = event.rawLog?.transactionHash || event.txHash || null;
    return !transactionHash || !eventHash || eventHash === transactionHash;
  });

  if (!swaps.length) {
    return {
      routeStatus: "UNKNOWN",
      route: [],
      logicalInput: null,
      logicalOutput: null,
    };
  }

  const transferLogs = (Array.isArray(logs) ? logs : [])
    .map((log) => decodeTransferLog(log, swaps[0]?.txHash || null))
    .filter((transfer) => transfer && transfer.logIndex != null);
  const route = swaps.map((swap, hopIndex) => {
    const assignedTransfers = transferLogs
      .filter((transfer) => transfer.tokenAddress && (
        transfer.from === swap.poolAddress || transfer.to === swap.poolAddress
      ))
      .filter((transfer) => {
        const samePoolSwaps = swaps.filter((candidate) => candidate.poolAddress === swap.poolAddress);
        return nearestSwapIndex(transfer.logIndex, samePoolSwaps) === samePoolSwaps.indexOf(swap);
      });
    const incoming = assignedTransfers.filter((transfer) => transfer.to === swap.poolAddress);
    const outgoing = assignedTransfers.filter((transfer) => transfer.from === swap.poolAddress);
    const evidence = {
      ammEvent: swap.rawLog || null,
      transferLogs: assignedTransfers.map((transfer) => transfer.rawLog),
    };

    if (incoming.length === 1 && outgoing.length === 1) {
      return {
        hopIndex,
        poolAddress: swap.poolAddress,
        tokenIn: incoming[0].tokenAddress,
        amountIn: incoming[0].amount,
        tokenOut: outgoing[0].tokenAddress,
        amountOut: outgoing[0].amount,
        evidence,
      };
    }

    return {
      hopIndex,
      poolAddress: swap.poolAddress,
      tokenIn: null,
      amountIn: null,
      tokenOut: null,
      amountOut: null,
      evidence,
      status: incoming.length === 1 && outgoing.length === 1 ? "COMPLETE" : "UNKNOWN",
    };
  });

  // Existing one-hop reconstruction can prove its boundary assets from the
  // wallet movements even when the receipt omits ERC-20 Transfer logs.
  if (route.length === 1 && route[0].tokenIn == null) {
    const tokenIn = movementToken(walletTransfers.outgoing);
    const tokenOut = movementToken(walletTransfers.incoming);
    if (tokenIn && tokenOut && walletTransfers.outgoing?.outgoingAmount != null && walletTransfers.incoming?.incomingAmount != null) {
      route[0] = {
        ...route[0],
        tokenIn,
        amountIn: walletTransfers.outgoing.outgoingAmount,
        tokenOut,
        amountOut: walletTransfers.incoming.incomingAmount,
        evidence: {
          ...route[0].evidence,
          walletTransfers: {
            outgoing: walletTransfers.outgoing.transferRefs || [],
            incoming: walletTransfers.incoming.transferRefs || [],
          },
        },
      };
    }
  }

  const complete = route.every((hop) => hop.tokenIn && hop.amountIn != null && hop.tokenOut && hop.amountOut != null);
  const logicalInput = route[0].tokenIn && route[0].amountIn != null
    ? { token: route[0].tokenIn, amount: route[0].amountIn }
    : null;
  const lastHop = route[route.length - 1];
  const logicalOutput = lastHop.tokenOut && lastHop.amountOut != null
    ? { token: lastHop.tokenOut, amount: lastHop.amountOut }
    : null;

  return {
    routeStatus: complete ? "COMPLETE" : "INCOMPLETE",
    route,
    logicalInput,
    logicalOutput,
  };
}

/**
 * Deterministic, evidence-derived reconstruction confidence scoring.
 * Replaces arbitrary constants (such as fixed 98%, 95%, or 85%).
 *
 * Each point is directly attributed to verifiable on-chain or valuation evidence:
 * - Opposing asset flow symmetry: 35
 * - Verified receipt AMM Swap event log: 40 (or 20 for other AMM events like Sync/Mint/Burn)
 * - Confirmed receipt execution success (status === "0x1"): 10
 * - Corroborating entity metadata: 10
 * - Independent valuation resolved: 5
 */
export function computeEvidenceConfidence({
  hasOpposingFlow = false,
  hasAmmSwap = false,
  hasAmmEvent = false,
  isSuccess = false,
  hasEntityLabel = false,
  hasValuation = false,
} = {}) {
  let score = 0;
  const breakdown = {};

  if (hasOpposingFlow) {
    score += 35;
    breakdown.opposingAssetFlow = 35;
  }
  if (hasAmmSwap) {
    score += 40;
    breakdown.receiptAmmSwapEvent = 40;
  } else if (hasAmmEvent) {
    score += 20;
    breakdown.receiptAmmNonSwapEvent = 20;
  }
  if (isSuccess) {
    score += 10;
    breakdown.receiptExecutionConfirmed = 10;
  }
  if (hasEntityLabel) {
    score += 10;
    breakdown.entityMetadataCorroborated = 10;
  }
  if (hasValuation) {
    score += 5;
    breakdown.valuationResolved = 5;
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    breakdown,
  };
}
