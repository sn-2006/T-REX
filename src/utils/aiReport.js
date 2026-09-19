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
  lines.push("DEX EVIDENCE");
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
  lines.push("Only values marked VERIFIED or DERIVED are treated as established; UNKNOWN and PENDING_REVIEW values require verification.");
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

  lines.push("OVERALL ASSESSMENT");
  lines.push("DECENTRALIZED WALLET ANALYSIS");
  lines.push(
    `T-REX analyzed ${Number(walletTransferCount || 0).toLocaleString("en-IN")} observable on-chain transfer(s) across ${Math.max(walletList.length, reconciliations.length, 1)} wallet(s).`
  );
  lines.push(
    "This is a wallet-only reconciliation. On-chain movements are analyzed separately from centralized exchange trades."
  );

  if (pendingTotal > 0) {
    lines.push(
      `${pendingTotal} on-chain transfer(s) remain pending manual review because ownership or taxable disposition could not be established.`
    );
  }

  const unmatchedCount =
    buckets.orphanedWithdrawals.length + unmatchedDeposits.length;
  if (unmatchedCount > 0) {
    lines.push(
      `${unmatchedCount} transaction(s) could not be matched to a corresponding record in the uploaded data.`
    );
  }

  if (buckets.unresolvedValuations.length > 0) {
    lines.push(
      `${buckets.unresolvedValuations.length} reconstructed event(s) have estimated or unresolved INR valuation and require settlement verification.`
    );
  }

  lines.push("");
  lines.push("RECONCILIATION");

  if (reconciliations.length > 0) {
    for (const r of reconciliations) {
      const manual = Number(r.manualVerificationCount) || 0;
      lines.push(`Observed transactions: ${r.transactionCount ?? 0}`);
      lines.push(`Incoming movements: ${r.incomingCount ?? 0}`);
      lines.push(`Outgoing movements: ${r.outgoingCount ?? 0}`);
      lines.push(`Manual verification required: ${Math.max(manual, pendingTotal)}`);
      lines.push(`TDS status: ${r.tdsStatus || "NOT_DETERMINED"}`);
      lines.push("");
    }
  } else {
    lines.push(`Observable on-chain transfers: ${walletTransferCount}`);
    lines.push(`Manual verification required: ${pendingTotal}`);
    lines.push("TDS status: NOT_DETERMINED");
    lines.push("");
  }

  if (pendingTotal > 0 || buckets.unresolvedValuations.length > 0) {
    lines.push("WARNINGS");
    for (const w of buckets.pendingManualReviews) {
      lines.push(`- ${w.message}`);
    }
    for (const w of buckets.unresolvedValuations) {
      lines.push(`- ${w.message}`);
    }
    for (const w of buckets.orphanedWithdrawals) {
      lines.push(`- ${w.message}`);
    }
    for (const d of unmatchedDeposits) {
      lines.push(`- ${d.message}`);
    }
    lines.push("");
  }

  lines.push("PROVENANCE");
  lines.push(
    "The displayed flow contains observable on-chain transaction edges and address enrichment/risk signals where available."
  );
  lines.push(
    "An on-chain movement by itself does not prove the ultimate real-world identity, ultimate source of funds, or that the movement was a taxable disposition."
  );
  lines.push("");

  appendDexEvidence(lines, walletList);

  appendRecommendedActions(lines, {
    orphanedWithdrawals: buckets.orphanedWithdrawals,
    unmatchedDeposits,
    valuationMismatches: buckets.valuationMismatches,
    unresolvedValuations: buckets.unresolvedValuations,
    pendingReviewTotal: pendingTotal,
  });

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

  lines.push("OVERALL ASSESSMENT");
  lines.push(
    `ChainTDS reviewed ${totalTradeGroups} asset/exchange trade groups and ${totalTransfers} cross-platform transfer(s).`
  );

  if (tdsGaps.length > 0) {
    lines.push(
      `${tdsGaps.length} transfer(s) require manual review because the source exchange showed TDS as pending at the time of transfer.`
    );
  } else {
    lines.push("No cross-platform transfers have a pending TDS status.");
  }

  if (pendingTotal > 0) {
    lines.push(
      `${pendingTotal} on-chain transfer(s) remain pending manual review because ownership or taxable disposition could not be established.`
    );
  }

  const unmatchedCount =
    buckets.orphanedWithdrawals.length + unmatchedDeposits.length;

  if (unmatchedCount > 0) {
    lines.push(
      `${unmatchedCount} transaction(s) could not be matched to a corresponding record in the uploaded data.`
    );
  }

  lines.push("");
  lines.push("TRADE SUMMARY");

  for (const s of tradeSummary) {
    lines.push(
      `${s.exchange} | ${s.asset} | ${s.tradeCount} trade(s) | ` +
      `${s.totalTraded.toFixed(4)} ${s.asset} | ` +
      `INR ${s.totalInr == null ? "Unavailable" : s.totalInr.toLocaleString("en-IN")} | ` +
      `TDS deducted: ${s.tdsDeductedCount}/${s.tradeCount}`
    );
  }

  lines.push("");

  if (transferChecks.length > 0) {
    lines.push("TRANSFER ANALYSIS");

    for (const tc of transferChecks) {
      const status = tc.status === "TDS_GAP" ? "REVIEW REQUIRED" : "OK";

      lines.push(
        `${tc.asset} ${tc.amount} | ${tc.from} -> ${tc.to} | ` +
        `${tc.fromDate} -> ${tc.toDate} | ${status} | ` +
        `Confidence: ${tc.confidence}%`
      );

      if (tc.status === "TDS_GAP") {
        lines.push(
          `Action: Verify whether TDS was subsequently deducted by ${tc.from}.`
        );
      }
    }
  } else {
    lines.push("TRANSFER ANALYSIS");
    lines.push("No cross-platform transfers were detected.");
  }

  lines.push("");

  if (unmatchedCount > 0) {
    lines.push("UNMATCHED TRANSACTIONS");

    for (const w of buckets.orphanedWithdrawals) {
      lines.push(`- ${w.message}`);
    }

    for (const d of unmatchedDeposits) {
      lines.push(`- ${d.message}`);
    }
  }

  lines.push("");

  appendRecommendedActions(lines, {
    tdsGaps,
    orphanedWithdrawals: buckets.orphanedWithdrawals,
    unmatchedDeposits,
    valuationMismatches: buckets.valuationMismatches,
    unresolvedValuations: buckets.unresolvedValuations,
    pendingReviewTotal: pendingTotal,
  });

  return lines.join("\n");
}
