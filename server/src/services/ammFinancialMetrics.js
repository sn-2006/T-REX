function unknownMetric(reason, evidence = {}) {
  return { status: "UNKNOWN", value: null, reason, evidence };
}

function asBigInt(value) {
  if (value == null || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function positiveAmounts(tokenAmounts = {}) {
  return Object.entries(tokenAmounts)
    .filter(([, value]) => asBigInt(value) != null && asBigInt(value) > 0n)
    .map(([key, value]) => ({ key, amount: asBigInt(value) }));
}

function swapFlow(swap) {
  const tokenAmounts = swap?.tokenAmounts || {};
  const incoming = positiveAmounts({
    amount0: tokenAmounts.amount0In,
    amount1: tokenAmounts.amount1In,
  });
  const outgoing = positiveAmounts({
    amount0: tokenAmounts.amount0Out,
    amount1: tokenAmounts.amount1Out,
  });
  if (incoming.length !== 1 || outgoing.length !== 1) return null;
  return { amountIn: incoming[0].amount, amountOut: outgoing[0].amount };
}

function eventEvidence(event) {
  return {
    transactionHash: event?.txHash || event?.rawLog?.transactionHash || null,
    poolAddress: event?.poolAddress || null,
    logIndex: event?.logIndex ?? null,
  };
}

function sameLogIndex(left, right) {
  if (left == null || right == null) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(typeof right === "string" && right.startsWith("0x") ? parseInt(right, 16) : right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

function derivePriceImpact(swap, reserveEvent) {
  const evidence = {
    swap: eventEvidence(swap),
    reserveEvent: eventEvidence(reserveEvent),
  };
  const flow = swapFlow(swap);
  const reservesAfter = reserveEvent?.reserveChanges;
  if (!flow || !reservesAfter?.reserve0 || !reservesAfter?.reserve1) {
    return unknownMetric("Observed swap direction or post-swap reserves are incomplete.", evidence);
  }

  const amount0In = asBigInt(swap.tokenAmounts.amount0In) || 0n;
  const amount1In = asBigInt(swap.tokenAmounts.amount1In) || 0n;
  const amount0Out = asBigInt(swap.tokenAmounts.amount0Out) || 0n;
  const amount1Out = asBigInt(swap.tokenAmounts.amount1Out) || 0n;
  const reserve0After = asBigInt(reservesAfter.reserve0);
  const reserve1After = asBigInt(reservesAfter.reserve1);
  const reserve0Before = reserve0After == null ? null : reserve0After - amount0In + amount0Out;
  const reserve1Before = reserve1After == null ? null : reserve1After - amount1In + amount1Out;

  const inputIsToken0 = amount0In > 0n && amount1Out > 0n && amount1In === 0n && amount0Out === 0n;
  const inputIsToken1 = amount1In > 0n && amount0Out > 0n && amount0In === 0n && amount1Out === 0n;
  const reserveIn = inputIsToken0 ? reserve0Before : inputIsToken1 ? reserve1Before : null;
  const reserveOut = inputIsToken0 ? reserve1Before : inputIsToken1 ? reserve0Before : null;
  if (reserveIn == null || reserveOut == null || reserveIn <= 0n || reserveOut <= 0n) {
    return unknownMetric("Positive pre-trade reserves and an unambiguous V2 swap direction are required.", {
      ...evidence,
      reservesAfter,
    });
  }

  const referencePrice = Number(reserveOut) / Number(reserveIn);
  const executionPrice = Number(flow.amountOut) / Number(flow.amountIn);
  if (!Number.isFinite(referencePrice) || !Number.isFinite(executionPrice) || referencePrice <= 0) {
    return unknownMetric("Reserve or execution values cannot be represented safely.", {
      ...evidence,
      reservesBefore: { reserve0: reserve0Before.toString(), reserve1: reserve1Before.toString() },
      reservesAfter,
    });
  }

  const value = 1 - executionPrice / referencePrice;
  return {
    status: "DERIVED",
    value,
    percent: value * 100,
    reason: null,
    evidence: {
      ...evidence,
      reservesBefore: { reserve0: reserve0Before.toString(), reserve1: reserve1Before.toString() },
      reservesAfter,
      amountIn: flow.amountIn.toString(),
      amountOut: flow.amountOut.toString(),
      referencePrice,
      executionPrice,
    },
  };
}

function parseRate(rate) {
  if (typeof rate !== "string" && typeof rate !== "number") return null;
  const text = String(rate);
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
    text,
  };
}

function feeEvidenceFor(feeEvidence, hop) {
  if (Array.isArray(feeEvidence)) {
    return feeEvidence.find((item) => item?.poolAddress === hop.poolAddress) || null;
  }
  return feeEvidence || null;
}

function deriveTradingFee(swap, hop, feeEvidence) {
  const evidence = { swap: eventEvidence(swap), fee: feeEvidence?.evidence || null };
  const rate = parseRate(feeEvidence?.rate);
  const flow = swapFlow(swap);
  if (!rate || !flow) return unknownMetric("A verified fee rate and unambiguous swap input are required.", evidence);
  const amount = feeEvidence.amount != null
    ? String(feeEvidence.amount)
    : (flow.amountIn * rate.numerator / rate.denominator).toString();
  return {
    status: "DERIVED",
    value: amount,
    rate: rate.text,
    reason: null,
    evidence: { ...evidence, amountIn: flow.amountIn.toString(), feeAmount: amount },
  };
}

function deriveGasCost(gasEvidence) {
  if (!gasEvidence || gasEvidence.gasFeeWei == null || gasEvidence.gasFeeEth == null) {
    return unknownMetric("Existing gas usage and gas price evidence is unavailable.", {
      transactionHash: gasEvidence?.transactionHash || null,
    });
  }
  return {
    status: "DERIVED",
    value: gasEvidence.gasFeeEth,
    nativeAmount: gasEvidence.gasFeeEth,
    gasFeeWei: gasEvidence.gasFeeWei,
    gasUsed: gasEvidence.gasUsed ?? null,
    gasPrice: gasEvidence.gasPrice ?? null,
    reason: null,
    evidence: gasEvidence.evidence || { transactionHash: gasEvidence.transactionHash || null },
  };
}

export function computeAmmFinancialMetrics({ decodedEvents = [], route = [], gasEvidence = null, feeEvidence = null } = {}) {
  const swaps = decodedEvents.filter((event) => event?.eventType === "Swap");
  const swapHops = route.length
    ? route.map((hop, hopIndex) => swaps.find((event) => event.poolAddress === hop.poolAddress && (sameLogIndex(event.logIndex, hop.evidence?.ammEvent?.logIndex) || hopIndex === 0 && swaps.length === 1)) || null)
    : swaps;
  const hops = swapHops.map((swap, hopIndex) => {
    if (!swap) {
      return {
        hopIndex,
        poolAddress: route[hopIndex]?.poolAddress || null,
        priceImpact: unknownMetric("The corresponding decoded swap event is unavailable."),
        tradingFee: unknownMetric("The corresponding decoded swap event is unavailable."),
      };
    }
    const reserveEvent = decodedEvents
      .filter((event) => event?.eventType === "Sync" && event.poolAddress === swap.poolAddress)
      .sort((left, right) => Math.abs((left.logIndex ?? 0) - (swap.logIndex ?? 0)) - Math.abs((right.logIndex ?? 0) - (swap.logIndex ?? 0)))[0] || null;
    const hop = route[hopIndex] || {};
    return {
      hopIndex,
      poolAddress: swap.poolAddress,
      priceImpact: derivePriceImpact(swap, reserveEvent),
      tradingFee: deriveTradingFee(swap, hop, feeEvidenceFor(feeEvidence, hop)),
    };
  });

  const derivedPriceImpacts = hops.filter((hop) => hop.priceImpact.status === "DERIVED");
  const priceImpact = {
    status: hops.length === 1 && derivedPriceImpacts.length === 1
      ? "DERIVED"
      : derivedPriceImpacts.length > 0 ? "PARTIAL" : "UNKNOWN",
    value: hops.length === 1 && derivedPriceImpacts.length === 1 ? derivedPriceImpacts[0].priceImpact.value : null,
    reason: hops.length > 1 ? "Multi-hop price impact is preserved per hop; no aggregate is invented." : derivedPriceImpacts.length ? null : "Required reserve/event evidence is unavailable.",
    hops: hops.map((hop) => hop.priceImpact),
    evidence: hops.length === 1 ? hops[0]?.priceImpact.evidence || {} : hops.map((hop) => hop.priceImpact.evidence || {}),
  };
  const derivedFees = hops.filter((hop) => hop.tradingFee.status === "DERIVED");
  const tradingFee = {
    status: derivedFees.length === hops.length && hops.length > 0 ? "DERIVED" : derivedFees.length ? "PARTIAL" : "UNKNOWN",
    value: hops.length === 1 && derivedFees.length === 1 ? derivedFees[0].tradingFee.value : null,
    rate: hops.length === 1 && derivedFees.length === 1 ? derivedFees[0].tradingFee.rate || null : null,
    reason: derivedFees.length ? null : "No verified fee rate/tier was supplied.",
    hops: hops.map((hop) => hop.tradingFee),
    evidence: hops.length === 1 ? hops[0]?.tradingFee.evidence || {} : hops.map((hop) => hop.tradingFee.evidence || {}),
  };

  return {
    priceImpact,
    tradingFee,
    gasCost: deriveGasCost(gasEvidence),
    hops,
  };
}
