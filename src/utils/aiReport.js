export function generateNarrativeReport({
  tradeSummary = [],
  transferChecks = [],
  warnings = [],
  unmatchedDeposits = [],
  walletPendingReviewCount = 0,
  mode = null,
  walletAnalyses = [],
  walletTransferCount = 0,
  walletReconciliation = [],
} = {}) {
  const walletList = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses || {}).filter(Boolean);
  const isWalletOnly =
    mode === "DECENTRALIZED_WALLET" ||
    (walletTransferCount > 0 &&
      tradeSummary.length === 0 &&
      transferChecks.length === 0 &&
      (walletList.length > 0 || (walletReconciliation || []).length > 0));

  if (isWalletOnly) {
    return generateWalletOnlyNarrative({
      warnings,
      unmatchedDeposits,
      walletPendingReviewCount,
      walletList,
      walletTransferCount:
        walletTransferCount ||
        walletList.reduce((sum, a) => sum + (Number(a.transferCount) || 0), 0),
      walletReconciliation,
    });
  }

  return generateExchangeNarrative({
    tradeSummary,
    transferChecks,
    warnings,
    unmatchedDeposits,
    walletPendingReviewCount,
  });
}

function pendingReviewTotal(warnings, walletPendingReviewCount) {
  const pendingManualReviews = warnings.filter((w) => w.type === "PENDING_MANUAL_REVIEW");
  return Math.max(pendingManualReviews.length, Number(walletPendingReviewCount) || 0);
}

function appendRecommendedActions(lines, {
  tdsGaps = [],
  orphanedWithdrawals = [],
  unmatchedDeposits = [],
  valuationMismatches = [],
  unresolvedValuations = [],
  pendingReviewTotal: pendingTotal = 0,
}) {
  lines.push("RECOMMENDED ACTIONS");

  let actionNumber = 1;

  for (const tc of tdsGaps) {
    lines.push(
      `${actionNumber}. Verify the TDS status of the ${tc.asset} transfer from ${tc.from} to ${tc.to}.`
    );
    actionNumber++;
  }

  for (const w of orphanedWithdrawals) {
    lines.push(
      `${actionNumber}. Trace unmatched withdrawal ${w.refId} and verify whether it moved to an external wallet, another exchange, or an off-ramp.`
    );
    actionNumber++;
  }

  for (const d of unmatchedDeposits) {
    lines.push(
      `${actionNumber}. Trace unmatched deposit ${d.refId} and identify its source.`
    );
    actionNumber++;
  }

  for (const v of valuationMismatches) {
    lines.push(
      `${actionNumber}. Review valuation mismatch ${v.refId} and verify the reported consideration against the determined consideration.`
    );
    actionNumber++;
  }

  for (const v of unresolvedValuations) {
    lines.push(
      `${actionNumber}. Manual INR valuation/settlement verification is required for ${v.refId} before compliance can be finalized.`
    );
    actionNumber++;
  }

  if (pendingTotal > 0) {
    lines.push(
      `${actionNumber}. Complete manual review for ${pendingTotal} on-chain transfer(s) whose ownership or taxable disposition remains unresolved.`
    );
    actionNumber++;
  }

  if (actionNumber === 1) {
    lines.push("No immediate manual actions are required.");
  }
}

function warningBuckets(warnings, unmatchedDeposits = []) {
  return {
    orphanedWithdrawals: warnings.filter((w) => w.type === "ORPHANED_WITHDRAWAL"),
    valuationMismatches: warnings.filter((w) => w.type === "VALUATION_MISMATCH"),
    unresolvedValuations: warnings.filter((w) =>
      ["VALUATION_UNRESOLVED", "VALUATION_ESTIMATED"].includes(w.type)
    ),
    pendingManualReviews: warnings.filter((w) => w.type === "PENDING_MANUAL_REVIEW"),
    unmatchedDeposits,
  };
}

function appendDexEvidence(lines, walletList) {
  const dexEvents = walletList.flatMap((analysis) => [
    ...(analysis?.derivedDexEvents || []),
    ...(analysis?.derivedTransactions || []),
  ]).filter((event, index, all) =>
    all.findIndex((candidate) => candidate?.refId === event?.refId) === index
  );
  const liquidityEvents = walletList.flatMap((analysis) => analysis?.derivedLiquidityEvents || []);
  const positions = walletList.flatMap((analysis) => analysis?.derivedLiquidityPositions || []);

  if (!dexEvents.length && !liquidityEvents.length && !positions.length) return;
  lines.push("TRADE SUMMARY");
  lines.push(`Reconstructed DEX transaction(s): ${dexEvents.length}`);
  for (const event of dexEvents) {
    const reconstruction = event.reconstruction || {};
    const metrics = reconstruction.financialMetrics || null;
    lines.push(
      `- ${event.txHash || "Transaction hash UNKNOWN"}: ${reconstruction.kind || "DEX event"}; ` +
      `pool ${reconstruction.poolAddress || "UNKNOWN"}; route ${reconstruction.routeStatus || "UNKNOWN"}.`
    );
    if (reconstruction.route?.length) {
      lines.push(`  Route hops: ${reconstruction.route.map((hop) => `${hop.tokenIn || "UNKNOWN"} -> ${hop.tokenOut || "UNKNOWN"}`).join(" | ")}`);
    }
    if (metrics) {
      lines.push(`  Price impact: ${metrics.priceImpact?.status || "UNKNOWN"}${metrics.priceImpact?.value == null ? "" : ` (${metrics.priceImpact.value})`}.`);
      lines.push(`  Trading fee: ${metrics.tradingFee?.status || "UNKNOWN"}${metrics.tradingFee?.value == null ? "" : ` (${metrics.tradingFee.value})`}.`);
      lines.push(`  Gas cost: ${metrics.gasCost?.status || "UNKNOWN"}${metrics.gasCost?.nativeAmount == null ? "" : ` (${metrics.gasCost.nativeAmount} native units)`}.`);
    }
  }
  for (const event of liquidityEvents) {
    lines.push(`- Liquidity ${event.eventType || "UNKNOWN"}: ${event.transactionHash || "transaction hash UNKNOWN"}; status ${event.interpretationStatus || "UNKNOWN"}.`);
  }
  for (const position of positions) {
    lines.push(`- LP position ${position.positionStatus || "UNKNOWN"}: pool ${position.poolAddress || "UNKNOWN"}; add ${position.originatingTransactionHash || "UNKNOWN"}; removal ${position.removalTransactionHash || "UNKNOWN"}.`);
  }
  lines.push("");
}

function generateWalletOnlyNarrative({
  warnings,
  unmatchedDeposits,
  walletPendingReviewCount,
  walletList,
  walletTransferCount,
  walletReconciliation,
}) {
  const lines = [];
  const buckets = warningBuckets(warnings, unmatchedDeposits);
  const pendingTotal = pendingReviewTotal(warnings, walletPendingReviewCount);
  const reconciliations =
    (walletReconciliation || []).length > 0
      ? walletReconciliation
      : walletList.map((a) => a?.reconciliation).filter(Boolean);

  const totalWallets = Math.max(walletList.length, reconciliations.length, 1);
  const totalTransfers = Number(walletTransferCount || 0).toLocaleString("en-IN");
  
  lines.push(
    `ChainTDS analyzed ${totalTransfers} on-chain transfers across ${totalWallets} wallet(s).`
  );

  const dexEvents = walletList.flatMap((analysis) => [
    ...(analysis?.derivedDexEvents || []),
    ...(analysis?.derivedTransactions || []),
  ]);
  const liquidityEvents = walletList.flatMap((analysis) => analysis?.derivedLiquidityEvents || []);
  const positions = walletList.flatMap((analysis) => analysis?.derivedLiquidityPositions || []);
  const tradeCount = dexEvents.length + liquidityEvents.length + positions.length;

  if (tradeCount > 0) {
    lines.push(`We reconstructed ${tradeCount} trade/liquidity events from the raw blockchain data.`);
  }

  const issues = [];
  if (pendingTotal > 0) {
    issues.push(`${pendingTotal} transfer(s) require manual review to confirm ownership or taxability.`);
  }
  const unmatchedCount = buckets.orphanedWithdrawals.length + unmatchedDeposits.length;
  if (unmatchedCount > 0) {
    issues.push(`${unmatchedCount} transaction(s) could not be matched to uploaded records.`);
  }
  if (buckets.unresolvedValuations.length > 0) {
    issues.push(`${buckets.unresolvedValuations.length} event(s) have estimated/unresolved INR valuations.`);
  }

  if (issues.length > 0) {
    lines.push("Action Required: " + issues.join(" "));
  } else {
    lines.push("No compliance issues were found. Everything reconciled cleanly.");
  }

  return lines.join("\n");
}

function generateExchangeNarrative({
  tradeSummary,
  transferChecks,
  warnings,
  unmatchedDeposits,
  walletPendingReviewCount,
}) {
  const lines = [];
  const totalTradeGroups = tradeSummary.length;
  const totalTransfers = transferChecks.length;
  const tdsGaps = transferChecks.filter((t) => t.status === "TDS_GAP");
  const buckets = warningBuckets(warnings, unmatchedDeposits);
  const pendingTotal = pendingReviewTotal(warnings, walletPendingReviewCount);

  lines.push(
    `ChainTDS reviewed ${totalTradeGroups} asset/exchange trade groups and ${totalTransfers} cross-platform transfer(s).`
  );

  const issues = [];
  if (tdsGaps.length > 0) {
    issues.push(`${tdsGaps.length} transfer(s) require manual review because the source exchange showed TDS as pending at the time of transfer.`);
  }

  const unmatchedCount = buckets.orphanedWithdrawals.length + unmatchedDeposits.length;
  if (unmatchedCount > 0) {
    issues.push(`${unmatchedCount} transaction(s) could not be matched to a corresponding record.`);
  }

  if (pendingTotal > 0) {
    issues.push(`${pendingTotal} transfer(s) remain pending manual review because ownership or taxable disposition could not be established.`);
  }

  if (issues.length > 0) {
    lines.push("Action Required: " + issues.join(" "));
  } else {
    lines.push("No compliance issues were found. Everything reconciled cleanly.");
  }

  return lines.join("\n");
}
