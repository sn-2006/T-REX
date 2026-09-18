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

// ---- 1. Top-level "AI Compliance Insights" panel stats ---------------------
export function buildComplianceInsights({ allRows, reconciliation, discrepancies }) {
  const { transferChecks, warnings, unmatchedDeposits } = reconciliation;

  const totalTransactions = allRows.length;
  const matchedTransactions = transferChecks.length * 2; // withdrawal + deposit leg, both resolved
  const probableTransfers = transferChecks.filter((t) => t.confidence >= 60 && t.confidence < 90).length;
  const unmatchedTransactions =
    warnings.filter((w) => w.type === "ORPHANED_WITHDRAWAL").length + unmatchedDeposits.length;
  const tdsDiscrepancyCount = discrepancies.filter(
  (d) => d.hasTdsDiscrepancy === true
).length;
  const highRiskCount = discrepancies.filter((d) => d.riskTier === "high").length;

  // Overall compliance confidence: a simple, fully deterministic blend of
  // (a) the average transfer-match confidence and (b) how much of the
  // expected TDS pool is actually covered ACROSS THE WHOLE REPORT — this
  // deliberately uses every sell (via computeAllTdsRows), not just the
  // filtered `discrepancies` list. Measuring coverage only over the
  // already-flagged bad transactions would guarantee a near-0% result
  // regardless of how compliant everything else is (e.g. 1 gap out of 12
  // clean transactions would still show ~0% "coverage").
  const avgTransferConfidence =
    transferChecks.length > 0
      ? transferChecks.reduce((sum, t) => sum + t.confidence, 0) / transferChecks.length
      : null;

  const allTdsRows = computeAllTdsRows(allRows);
  const totalExpectedTds = allTdsRows.reduce((sum, d) => sum + d.expectedTds, 0);
  const totalReportedTds = allTdsRows.reduce((sum, d) => sum + d.reportedTds, 0);
  const tdsCoveragePct =
    totalExpectedTds > 0 ? Math.max(0, Math.min(100, (totalReportedTds / totalExpectedTds) * 100)) : 100;
  const components = [avgTransferConfidence, tdsCoveragePct].filter((v) => v !== null);
  const overallConfidence =
    components.length > 0 ? Math.round(components.reduce((a, b) => a + b, 0) / components.length) : 100;

  return {
    totalTransactions,
    matchedTransactions,
    probableTransfers,
    unmatchedTransactions,
    tdsDiscrepancyCount,
    highRiskCount,
    overallConfidence,
  };
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
export function buildTransactionEvidence(flag, { reconciliation, allRows }) {
  const { transferChecks } = reconciliation;

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
    ruleTriggered: `Transfer matcher: same asset, amount within 0.01%, ${5}-day window`,
  };
}
