import { computeAllTdsRows } from "./tdsDiscrepancy.js";

// ---------------------------------------------------------------------------
// Evidence builder.
//
// This is the ONLY bridge between the deterministic engine (reconcile.js,
// tdsDiscrepancy.js) and the AI explainability layer
// (services/complianceAssistant.js). Every number the AI is ever shown
// passes through here, already computed — this module builds structured
// "evidence packets," it never computes anything the rule engine hasn't
// already decided. That's what makes the AI's output auditable: any
// explanation can be traced back to a specific evidence packet built here.
// ---------------------------------------------------------------------------

const CONFIDENCE_METHOD = "heuristic_evidence_completeness";
const CONFIDENCE_LIMITATIONS =
  "Deterministic heuristic from available reconciliation signals (transfer matches, TDS coverage, valuation resolution, wallet pending share). Not a statistically validated probability.";

// ---- 1. Top-level "AI Compliance Insights" panel stats ---------------------
export function buildComplianceInsights({ allRows, reconciliation, discrepancies, walletAnalyses = {} }) {
  const { transferChecks, warnings, unmatchedDeposits } = reconciliation;

  const walletList = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses).filter(Boolean);
  const walletTransferCount = walletList.reduce((sum, a) => sum + (Number(a.transferCount) || 0), 0);
  const walletPendingReviewCount = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.pendingReviewCount) || 0),
    0
  );
  const walletOnly = allRows.length === 0 && walletTransferCount > 0;
  const totalTransactions = walletOnly ? walletTransferCount : allRows.length;
  const matchedTransactions = walletOnly ? 0 : transferChecks.length * 2; // withdrawal + deposit leg, both resolved
  const probableTransfers = transferChecks.filter((t) => t.confidence >= 60 && t.confidence < 90).length;
  const unmatchedTransactions =
    warnings.filter((w) => w.type === "ORPHANED_WITHDRAWAL").length + unmatchedDeposits.length;
  const tdsDiscrepancyCount = discrepancies.filter(
  (d) => d.hasTdsDiscrepancy === true
).length;
  const highRiskCount = discrepancies.filter((d) => d.riskTier === "high").length;

  const avgTransferConfidence =
    transferChecks.length > 0
      ? transferChecks.reduce((sum, t) => sum + t.confidence, 0) / transferChecks.length
      : null;

  const allTdsRows = computeAllTdsRows(allRows);
  const tdsReviewRequiredCount = allTdsRows.filter((row) => row.reviewRequired === true).length;
  const pendingManualWarningCount = warnings.filter((w) => w.type === "PENDING_MANUAL_REVIEW").length;
  // Wallet pending review and TDS/valuation review share one pending KPI so
  // AI insights never report "clear" while inventory still needs action.
  const reviewRequiredCount =
    tdsReviewRequiredCount + Math.max(walletPendingReviewCount, pendingManualWarningCount);
  const reportableTdsRows = allTdsRows.filter(
    (row) => row.expectedTds != null && row.reportedTds != null
  );
  const totalExpectedTds = reportableTdsRows.reduce((sum, d) => sum + d.expectedTds, 0);
  const totalReportedTds = reportableTdsRows.reduce((sum, d) => sum + d.reportedTds, 0);
  const tdsCoveragePct =
    totalExpectedTds > 0
      ? Math.max(0, Math.min(100, (totalReportedTds / totalExpectedTds) * 100))
      : null;
  // Estimated INR is useful evidence but is NOT independently verified settlement.
  const resolvedValuationStatuses = new Set([
    "DETERMINED",
    "VALIDATED",
    "REFERENCE_DETERMINED",
    "VERIFIED_INR",
  ]);
  const valuationRowCount = allTdsRows.length;
  const unresolvedValuationCount = allTdsRows.filter(
    (row) =>
      row.consideration?.valuationStatus === "UNRESOLVED" ||
      row.consideration?.valuationStatus === "PENDING_VALUATION" ||
      row.consideration?.valuationStatus === "ESTIMATED_INR"
  ).length;
  const incompleteValuationCount = allTdsRows.filter(
    (row) => !resolvedValuationStatuses.has(row.consideration?.valuationStatus)
  ).length;
  const valuationCompletenessPct =
    valuationRowCount > 0
      ? Math.max(
          0,
          Math.min(
            100,
            ((valuationRowCount - incompleteValuationCount) / valuationRowCount) * 100
          )
        )
      : null;

  const openWarningCount =
    warnings.filter((w) =>
      [
        "PENDING_MANUAL_REVIEW",
        "VALUATION_ESTIMATED",
        "VALUATION_UNRESOLVED",
        "VALUATION_MISMATCH",
        "ORPHANED_WITHDRAWAL",
        "TDS_GAP",
      ].includes(w.type)
    ).length + unmatchedDeposits.length;

  const confidence = computeEvidenceBasedConfidence({
    avgTransferConfidence,
    tdsCoveragePct,
    valuationCompletenessPct,
    walletList,
    walletOnly,
    totalTransactions,
    reviewRequiredCount,
    unmatchedTransactions,
    unresolvedValuationCount,
    openWarningCount,
  });

  return {
    totalTransactions,
    matchedTransactions,
    walletOnly,
    probableTransfers,
    unmatchedTransactions,
    tdsDiscrepancyCount,
    highRiskCount,
    reviewRequiredCount,
    unresolvedValuationCount,
    valuationCompletenessPct: valuationCompletenessPct ?? 0,
    overallConfidence: confidence.overallConfidence,
    confidenceMethod: confidence.confidenceMethod,
    confidenceLimitations: confidence.confidenceLimitations,
    confidenceIsHeuristic: true,
    walletPendingReviewCount,
  };
}

/**
 * Evidence-based heuristic confidence.
 *
 * Combines only signals the rule engine already produced, then scales by the
 * share of unresolved items. This is NOT a statistically validated model —
 * it is a deterministic completeness indicator for the UI/AI layer.
 */
export function computeEvidenceBasedConfidence({
  avgTransferConfidence = null,
  tdsCoveragePct = null,
  valuationCompletenessPct = null,
  walletList = [],
  walletOnly = false,
  totalTransactions = 0,
  reviewRequiredCount = 0,
  unmatchedTransactions = 0,
  unresolvedValuationCount = 0,
  openWarningCount = 0,
} = {}) {
  const walletResolutionPct = walletResolutionScore(walletList);
  const components = [
    avgTransferConfidence,
    tdsCoveragePct,
    valuationCompletenessPct,
    walletOnly || walletList.length > 0 ? walletResolutionPct : null,
  ].filter((v) => v !== null && Number.isFinite(v));

  const base =
    components.length > 0
      ? components.reduce((a, b) => a + b, 0) / components.length
      : walletOnly
        ? walletResolutionPct ?? 100
        : 100;

  const openItems = Math.max(
    reviewRequiredCount,
    unmatchedTransactions + unresolvedValuationCount,
    openWarningCount
  );
  const denominator = Math.max(Number(totalTransactions) || 0, openItems, 1);
  const unresolvedShare = Math.min(1, openItems / denominator);

  // Proportional drag from unresolved evidence — replaces a flat ≤55% ceiling.
  // residualFloor keeps a non-zero observation score when everything is open.
  const residualFloor = 0.12;
  const adjusted = Math.round(base * (1 - (1 - residualFloor) * unresolvedShare));

  return {
    overallConfidence: Math.max(0, Math.min(100, adjusted)),
    confidenceMethod: CONFIDENCE_METHOD,
    confidenceLimitations: CONFIDENCE_LIMITATIONS,
    confidenceIsHeuristic: true,
    unresolvedShare,
    baseConfidence: Math.round(base),
  };
}

function walletResolutionScore(walletList) {
  const raw = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.rawTransferCount) || Number(a.transferCount) || 0),
    0
  );
  if (!raw) return null;

  const pending = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.pendingReviewCount) || 0),
    0
  );
  const verified = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.verifiedRecordCount) || 0),
    0
  );
  const estimated = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.estimatedValueRecordCount) || 0),
    0
  );
  const accounted = walletList.reduce(
    (sum, a) => sum + (Number(a.traceability?.accountedTransferCount) || 0),
    0
  );

  // Accounted share is observable progress; verified share is stronger evidence.
  // Estimated legs count toward accounted but not verified settlement.
  const accountedShare = (accounted / raw) * 70;
  const verifiedShare = (verified / raw) * 30;
  const pendingPenalty = (pending / raw) * 40;
  const estimatedPenalty = (estimated / raw) * 10;
  let score = Math.round(accountedShare + verifiedShare - pendingPenalty - estimatedPenalty);

  const riskScores = walletList.flatMap((a) =>
    (a.provenance?.nodes || [])
      .map((n) => Number(n.riskScore))
      .filter((n) => Number.isFinite(n))
  );
  if (riskScores.length) {
    const riskConfidence = Math.round(
      riskScores.reduce((sum, scoreValue) => sum + Math.max(0, 100 - scoreValue), 0) /
        riskScores.length
    );
    score = Math.round((Math.max(0, score) + riskConfidence) / 2);
  }

  return Math.max(0, Math.min(100, score));
}

function findWalletInventoryItem(refId, walletAnalyses = []) {
  const list = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses || {}).filter(Boolean);
  for (const analysis of list) {
    const inventory = analysis?.traceability?.inventory || [];
    const match = inventory.find((item) => item.rawTransferId === refId);
    if (match) return match;
  }
  return null;
}

function findWalletDexEvidence(refId, walletAnalyses = [], sourceRow = null) {
  const list = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses || {}).filter(Boolean);
  for (const analysis of list) {
    const dexEvents = [
      ...(analysis.derivedDexEvents || []),
      ...(analysis.derivedTransactions || []),
    ];
    const event = dexEvents.find((candidate) =>
      candidate?.refId === refId ||
      candidate?.txHash === refId ||
      candidate?.reconstruction?.txHash === refId
    );
    if (event) {
      const reconstruction = event.reconstruction || {};
      const valuationEvidence = event.valuationEvidence || {};
      const transactionHash = event.txHash || valuationEvidence.transactionHash || null;
      return {
        transactionHash,
        poolAddress: reconstruction.poolAddress || valuationEvidence.poolAddress || null,
        route: reconstruction.route || valuationEvidence.route || null,
        liquidityEvents: (analysis.derivedLiquidityEvents || []).filter(
          (liquidity) => liquidity.transactionHash === transactionHash || liquidity.txHash === transactionHash
        ),
        liquidityPositions: (analysis.derivedLiquidityPositions || []).filter(
          (position) =>
            position.originatingTransactionHash === transactionHash ||
            position.removalTransactionHash === transactionHash
        ),
        financialMetrics: reconstruction.financialMetrics || valuationEvidence.financialMetrics || null,
        rawEvidence: {
          decodedEvents: reconstruction.decodedEvents || valuationEvidence.ammEvents || [],
          uninterpretedLogs: reconstruction.uninterpretedLogs || [],
          valuationEvidence,
        },
      };
    }
  }

  if (sourceRow?.transactionSource === "DECENTRALIZED_DEX") {
    return {
      transactionHash: sourceRow.txHash || null,
      poolAddress: sourceRow.valuationEvidence?.poolAddress || null,
      route: sourceRow.valuationEvidence?.route || null,
      liquidityEvents: [],
      liquidityPositions: [],
      financialMetrics: sourceRow.valuationEvidence?.financialMetrics || null,
      rawEvidence: { valuationEvidence: sourceRow.valuationEvidence || null },
    };
  }
  return null;
}

/**
 * Resolve wallet analyses for a persisted auditor/regulator case.
 * Prefer the top-level case field; fall back to the snapshot embedded in
 * reconciliation JSONB at save time (existing cases column, no migration).
 */
export function resolveCaseWalletAnalyses(case_) {
  if (!case_ || typeof case_ !== "object") return {};
  if (case_.walletAnalyses && typeof case_.walletAnalyses === "object") {
    return case_.walletAnalyses;
  }
  const embedded = case_.reconciliation?.walletAnalyses;
  if (embedded && typeof embedded === "object") return embedded;
  return {};
}

/**
 * Case-detail evidence path — same walletAnalyses wiring as TaxpayerDashboard.
 */
export function buildCaseTransactionEvidence(case_, flag) {
  return buildTransactionEvidence(flag, {
    reconciliation: case_?.reconciliation || {
      transferChecks: [],
      warnings: [],
      unmatchedDeposits: [],
    },
    allRows: case_?.allRows || [],
    walletAnalyses: resolveCaseWalletAnalyses(case_),
  });
}

function firstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

// ---- 2. Per-discrepancy evidence packet ------------------------------------
export function buildDiscrepancyEvidence(discrepancy, { reconciliation, allRows }) {
  const { transferChecks } = reconciliation;

  const relatedTransfer = transferChecks.find(
    (t) => t.fromRef === discrepancy.transactionId || t.toRef === discrepancy.transactionId
  );

  const matchingTransactions = allRows
    .filter(
      (r) =>
        r.refId !== discrepancy.transactionId &&
        r.asset === discrepancy.asset &&
        Math.abs(r.amount - discrepancy.quantity) < discrepancy.quantity * 0.02 + 1e-9
    )
    .map((r) => ({ transactionId: r.refId, exchange: r.exchange, type: r.type, date: r.date, amount: r.amount }));

  return {
    transactionId: discrepancy.transactionId,
    date: discrepancy.date,
    asset: discrepancy.asset,
    quantity: discrepancy.quantity,
    type: discrepancy.type,
    sourceExchange: discrepancy.exchange,
    destinationExchange: relatedTransfer ? relatedTransfer.to : null,
    amount: discrepancy.inrValue,
    consideration: discrepancy.consideration,
    transactionClassification: discrepancy.transactionClassification,
    vdaTransferStatus: discrepancy.vdaTransferStatus,
    transferType: discrepancy.transferType,
    transferConfidence: discrepancy.transferConfidence,
    expectedTds: discrepancy.expectedTds,
    reportedTds: discrepancy.reportedTds,
    reportedSource: discrepancy.reportedSource,
    difference: discrepancy.difference,
    matchingTransactions,
    transferConfidence: relatedTransfer ? relatedTransfer.confidence : null,
    ruleTriggered: "Section 194S — 1% TDS on SELL value, compared against reported deduction",
    riskTier: discrepancy.riskTier,
    missingOrConflictingRecords:
      matchingTransactions.length === 0
        ? [`No other transaction for ${discrepancy.quantity} ${discrepancy.asset} found in the uploaded data.`]
        : [],
  };
}

// ---- 3. Per-transaction investigation evidence packet ----------------------
// Covers three kinds of flags the rule engine can raise:
//   - ORPHANED_WITHDRAWAL / UNKNOWN_SOURCE: genuinely unmatched legs, where
//     the question is "where did this go / come from?"
//   - TDS_GAP: a transfer the matcher DID successfully resolve, but where
//     TDS was still pending when it left the source exchange. This is a
//     different kind of problem — there's no "search for a match" to
//     explain, the match already succeeded, so it gets its own branch
//     instead of being forced through the unmatched-transaction template
//     (which previously produced a nonsensical "could not find a match"
//     explanation for something that was, in fact, matched).
export function buildTransactionEvidence(flag, { reconciliation, allRows, walletAnalyses = [] }) {
  const { transferChecks } = reconciliation;

  if (["VALUATION_UNRESOLVED", "VALUATION_ESTIMATED"].includes(flag.type)) {
    const sourceRow = allRows.find((r) => r.refId === flag.refId);
    return {
      transactionId: flag.refId,
      status: flag.type,
      asset: sourceRow?.asset ?? null,
      quantity: sourceRow?.amount ?? null,
      date: sourceRow?.date ?? null,
      sourceExchange: sourceRow?.exchange ?? null,
      destinationExchange: null,
      matchingConfidence: null,
      closestCandidate: null,
      recordsUsedForReconciliation: [sourceRow?.refId].filter(Boolean),
      consideration: sourceRow?.consideration ?? null,
      valuationStatus: sourceRow?.valuationStatus || sourceRow?.consideration?.valuationStatus || "UNRESOLVED",
      actualInrReceived: sourceRow?.actualInrReceived ?? null,
      estimatedInrValue: sourceRow?.estimatedInrValue ?? null,
      valuationEvidence: sourceRow?.valuationEvidence ?? null,
      dexEvidence: findWalletDexEvidence(flag.refId, walletAnalyses, sourceRow),
      expectedTds: null,
      reportedTds: null,
      ruleTriggered: "INR valuation required before expected TDS can be determined",
    };
  }

  if (flag.type === "PENDING_MANUAL_REVIEW") {
    const inventory = findWalletInventoryItem(flag.refId, walletAnalyses);
    const asset = firstAvailable(flag.asset, inventory?.asset);
    const quantity = firstAvailable(flag.amount, inventory?.amount);
    const date = firstAvailable(flag.date, inventory?.timestamp);
    const txHash = firstAvailable(flag.txHash, inventory?.txHash);
    const direction = firstAvailable(flag.direction, inventory?.direction);
    const from = firstAvailable(flag.from, inventory?.from);
    const to = firstAvailable(flag.to, inventory?.to);
    const reason = firstAvailable(flag.reason, inventory?.reason);
    const dexEvidence = findWalletDexEvidence(flag.refId, walletAnalyses);

    return {
      transactionId: flag.refId,
      status: "PENDING_MANUAL_REVIEW",
      asset,
      quantity,
      date,
      txHash,
      direction,
      from,
      to,
      sourceAddress: from,
      destinationAddress: to,
      sourceExchange: null,
      destinationExchange: null,
      matchingConfidence: null,
      closestCandidate: null,
      recordsUsedForReconciliation: [flag.refId].filter(Boolean),
      expectedTds: null,
      reportedTds: null,
      reason,
      evidenceSources: flag.evidenceSources || inventory?.evidenceSources || null,
      dexEvidence,
      ruleTriggered:
        "On-chain movement observed, but ownership or taxable disposition evidence is insufficient for automated reconciliation",
    };
  }

  if (flag.type === "TDS_GAP") {
    const transfer = transferChecks.find((t) => t.fromRef === flag.refId);
    return {
      transactionId: flag.refId,
      status: "TDS_GAP",
      asset: transfer?.asset ?? null,
      quantity: transfer?.amount ?? null,
      date: transfer?.fromDate ?? null,
      sourceExchange: transfer?.from ?? null,
      destinationExchange: transfer?.to ?? null,
      matchingConfidence: transfer?.confidence ?? null,
      closestCandidate: null,
      recordsUsedForReconciliation: [transfer?.fromRef, transfer?.toRef].filter(Boolean),
      ruleTriggered: "TDS gap check: source exchange's tds_status was PENDING at the moment of transfer",
    };
  }

  const sourceRow = allRows.find((r) => r.refId === flag.refId);
  const isWithdrawal = flag.type === "ORPHANED_WITHDRAWAL";
  const dexEvidence = findWalletDexEvidence(flag.refId, walletAnalyses, sourceRow);

  // Best partial match, even if it didn't clear the matcher's thresholds —
  // useful context for "why wasn't this matched" even when nothing matched.
  const candidatePool = allRows.filter(
    (r) =>
      r.refId !== flag.refId &&
      r.asset === sourceRow?.asset &&
      r.type === (isWithdrawal ? "DEPOSIT" : "WITHDRAWAL")
  );
  const bestCandidate =
    candidatePool.length > 0
      ? candidatePool.reduce((best, r) => {
          const gap = sourceRow ? Math.abs(r.amount - sourceRow.amount) : Infinity;
          const bestGap = best ? Math.abs(best.amount - sourceRow.amount) : Infinity;
          return gap < bestGap ? r : best;
        }, null)
      : null;

  let matchingConfidence = 0;
  if (sourceRow && bestCandidate) {
    const amountGapPct = sourceRow.amount > 0 ? Math.abs(bestCandidate.amount - sourceRow.amount) / sourceRow.amount : 1;
    matchingConfidence = Math.round(Math.max(0, 1 - amountGapPct) * 100);
  }

  return {
    transactionId: flag.refId,
    status: flag.type,
    asset: sourceRow?.asset ?? null,
    quantity: sourceRow?.amount ?? null,
    date: sourceRow?.date ?? null,
    sourceExchange: isWithdrawal ? sourceRow?.exchange ?? null : bestCandidate?.exchange ?? "Unknown",
    destinationExchange: isWithdrawal ? bestCandidate?.exchange ?? "Unknown" : sourceRow?.exchange ?? null,
    matchingConfidence,
    closestCandidate: bestCandidate
      ? { transactionId: bestCandidate.refId, exchange: bestCandidate.exchange, amount: bestCandidate.amount, date: bestCandidate.date }
      : null,
    recordsUsedForReconciliation: [sourceRow?.refId, bestCandidate?.refId].filter(Boolean),
    dexEvidence,
    ruleTriggered: `Transfer matcher: same asset, amount within 0.01%, ${5}-day window`,
  };
}
