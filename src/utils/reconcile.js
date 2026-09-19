import { daysBetween } from "./parseExchange.js";

// Runs the core ChainTDS reconciliation logic across all uploaded exchange
// transactions (and, optionally, on-chain wallet transfers).
// Returns: { tradeSummary, transferChecks, warnings, unmatchedDeposits }
//
// unmatchedDeposits and the per-transfer `confidence` score are additive —
// every field that existed before is unchanged, so nothing downstream
// (PDF export, existing UI tables) needs to change. They exist so the AI
// explainability layer (utils/evidenceBuilder.js) has real, deterministic
// numbers to explain rather than having to invent them — the rule engine
// decides what's a match and how confident it is; the AI only explains it.
export function reconcile(allRows) {
  const trades = allRows.filter((r) => r.type === "SELL" || r.type === "BUY");
  const withdrawals = allRows.filter((r) => r.type === "WITHDRAWAL");
  const deposits = allRows.filter((r) => r.type === "DEPOSIT");

  // 1. Trade summary — per-asset totals and TDS deducted, per exchange
  const summaryMap = {};
  for (const t of trades) {
    const key = `${t.exchange}__${t.asset}`;
    if (!summaryMap[key]) {
      summaryMap[key] = {
        exchange: t.exchange,
        asset: t.asset,
        totalTraded: 0,
        totalInr: 0,
        tdsDeductedCount: 0,
        tradeCount: 0,
      };
    }
    const s = summaryMap[key];
    s.tradeCount += 1;
    s.totalTraded += t.amount;
    const inrValue = t.consideration?.inrValue ?? t.inrValue;
    if (s.totalInr != null) {
      s.totalInr = inrValue == null || !Number.isFinite(Number(inrValue))
        ? null
        : s.totalInr + Number(inrValue);
    }
    if (t.tdsStatus === "DEDUCTED") s.tdsDeductedCount += 1;
  }
  const tradeSummary = Object.values(summaryMap);

  // 2. Transfer check — match withdrawals on one exchange to deposits on
  // another for the same asset, within a 5-day window. This is the
  // cross-platform check no single exchange can do on its own.
  //
  // Each match also gets a deterministic `confidence` score (0-100):
  // 60 points for how close the two amounts are (exact = full 60, degrades
  // linearly to 0 at a 2% gap) + 40 points for how close in time they are
  // (same day = full 40, degrades linearly to 0 at the 5-day window edge).
  // This is the ONLY place confidence is computed — the AI layer reads it,
  // never invents its own.
  const transferChecks = [];
  const matchedWithdrawalIds = new Set();
  const matchedDepositIds = new Set();

  function matchConfidence(w, d) {
    const amountGapPct = w.amount > 0 ? Math.abs(d.amount - w.amount) / w.amount : 0;
    const amountScore = Math.max(0, 1 - amountGapPct / 0.02) * 60;
    const gapDays = daysBetween(w.date, d.date);
    const timeScore = Math.max(0, 1 - gapDays / 5) * 40;
    return Math.round(amountScore + timeScore);
  }

  for (const w of withdrawals) {
    const candidate = deposits.find(
      (d) =>
        d.exchange !== w.exchange &&
        d.asset === w.asset &&
        Math.abs(d.amount - w.amount) < 0.0001 &&
        daysBetween(w.date, d.date) <= 5 &&
        !matchedDepositIds.has(d.refId)
    );

    if (candidate) {
      matchedWithdrawalIds.add(w.refId);
      matchedDepositIds.add(candidate.refId);
      const gap = w.tdsStatus === "PENDING";
      transferChecks.push({
        asset: w.asset,
        amount: w.amount,
        from: w.exchange,
        to: candidate.exchange,
        fromRef: w.refId,
        toRef: candidate.refId,
        fromDate: w.date,
        toDate: candidate.date,
        status: gap ? "TDS_GAP" : "OK",
        confidence: matchConfidence(w, candidate),
      });
    }
  }

  // 3. Warnings — orphaned withdrawals (no matching deposit found anywhere)
  // and any transfer flagged with a TDS gap above.
  const warnings = [];

  for (const w of withdrawals) {
    if (!matchedWithdrawalIds.has(w.refId)) {
      warnings.push({
        type: "ORPHANED_WITHDRAWAL",
        message: `${w.amount} ${w.asset} withdrawn from ${w.exchange} on ${w.date} has no matching deposit on record — could be a personal wallet, another platform not uploaded, or off-ramp.`,
        refId: w.refId,
      });
    }
  }

  for (const tc of transferChecks) {
    if (tc.status === "TDS_GAP") {
      warnings.push({
        type: "TDS_GAP",
        message: `${tc.amount} ${tc.asset} moved from ${tc.from} to ${tc.to}, but TDS status was still pending at the time of transfer — needs manual review.`,
        refId: tc.fromRef,
      });
    }
  }
  for (const t of trades) {
  if (t.consideration?.valuationStatus === "MISMATCH") {
    warnings.push({
      type: "VALUATION_MISMATCH",
      message:
        `${t.refId} on ${t.exchange} has a valuation mismatch: ` +
        `reported consideration ₹${t.consideration.reportedInrValue?.toLocaleString("en-IN") ?? "N/A"} ` +
        `vs determined consideration ₹${t.consideration.inrValue?.toLocaleString("en-IN") ?? "N/A"}.`,
      refId: t.refId,
    });
  }
  if (["UNRESOLVED", "PENDING_VALUATION", "ESTIMATED_INR"].includes(t.consideration?.valuationStatus)) {
    warnings.push({
      type: t.consideration?.valuationStatus === "ESTIMATED_INR"
        ? "VALUATION_ESTIMATED"
        : "VALUATION_UNRESOLVED",
      message:
        t.consideration?.valuationStatus === "ESTIMATED_INR"
          ? `${t.refId} on ${t.exchange} has estimated INR fair-market value but no verified INR settlement evidence — manual verification is required before compliance can be finalized.`
          : `${t.refId} on ${t.exchange} has no independently determined INR consideration — manual INR valuation verification is required before compliance can be finalized.`,
      refId: t.refId,
    });
  }
}

  // 4. Unmatched deposits — the mirror image of orphaned withdrawals: money
  // that arrived with no visible origin in the uploaded data. Tracked
  // separately (not folded into `warnings`) so the AI investigation layer
  // can address "unknown source" deposits with their own explanation,
  // matching the "Unknown Wallet" scenario in the investigation spec.
  const unmatchedDeposits = deposits
    .filter((d) => !matchedDepositIds.has(d.refId))
    .map((d) => ({
      type: "UNKNOWN_SOURCE",
      message: `${d.amount} ${d.asset} arrived on ${d.exchange} on ${d.date} with no matching withdrawal found elsewhere in the uploaded data.`,
      refId: d.refId,
    }));

  return { tradeSummary, transferChecks, warnings, unmatchedDeposits };
}

/**
 * Merge wallet/on-chain pending-review and estimated-value evidence into the
 * same warnings channel used by the dashboard, investigation queue, and AI.
 * Does not invent matches — only surfaces unresolved inventory outcomes.
 * Attaches available inventory fields (asset, date, hash, direction, from/to)
 * when present; missing fields stay null.
 */
export function withWalletReconciliationFlags(reconciliation, walletAnalyses = []) {
  const base = reconciliation || {
    tradeSummary: [],
    transferChecks: [],
    warnings: [],
    unmatchedDeposits: [],
  };
  const list = Array.isArray(walletAnalyses)
    ? walletAnalyses.filter(Boolean)
    : Object.values(walletAnalyses || {}).filter(Boolean);

  const warnings = [...(base.warnings || [])];
  const seen = new Set(warnings.map((w) => `${w.type}:${w.refId}`));

  for (const analysis of list) {
    const inventoryByRef = new Map(
      (analysis?.traceability?.inventory || []).map((item) => [item.rawTransferId, item])
    );
    const outcomes = analysis?.traceability?.transferOutcomes || [];
    for (const outcome of outcomes) {
      if (outcome.status !== "PENDING_MANUAL_REVIEW") continue;
      const key = `PENDING_MANUAL_REVIEW:${outcome.refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const inventory = inventoryByRef.get(outcome.refId) || null;
      warnings.push({
        type: "PENDING_MANUAL_REVIEW",
        refId: outcome.refId,
        message:
          `${outcome.refId}: on-chain transfer requires manual review — ` +
          `${outcome.reason || "ownership or taxable disposition could not be established."}`,
        asset: inventory?.asset ?? null,
        amount: inventory?.amount ?? null,
        date: inventory?.timestamp ?? null,
        txHash: inventory?.txHash ?? null,
        direction: inventory?.direction ?? null,
        from: inventory?.from ?? null,
        to: inventory?.to ?? null,
        reason: outcome.reason || inventory?.reason || null,
        evidenceSources: outcome.evidenceSources || inventory?.evidenceSources || null,
      });
    }
  }

  const walletPendingReviewCount = list.reduce(
    (sum, analysis) => sum + (Number(analysis?.traceability?.pendingReviewCount) || 0),
    0
  );
  const walletEstimatedValueCount = list.reduce(
    (sum, analysis) => sum + (Number(analysis?.traceability?.estimatedValueRecordCount) || 0),
    0
  );
  const walletVerifiedCount = list.reduce(
    (sum, analysis) => sum + (Number(analysis?.traceability?.verifiedRecordCount) || 0),
    0
  );

  return {
    ...base,
    warnings,
    walletPendingReviewCount,
    walletEstimatedValueCount,
    walletVerifiedCount,
    hasUnresolvedItems:
      warnings.length > 0 ||
      (base.unmatchedDeposits || []).length > 0 ||
      walletPendingReviewCount > 0,
  };
}

// ---------------------------------------------------------------------------
// Decentralized wallet reconciliation.
//
// Wallet-only analysis is different from exchange-ledger reconciliation.
// A blockchain transfer proves that VDA moved, but by itself does not prove
// that the movement was a taxable disposition or provide INR consideration.
//
// This function therefore:
//   1. Reconciles observable wallet movements.
//   2. Separates incoming/outgoing movements.
//   3. Flags ownership-unknown movements for manual verification.
//   4. Does NOT invent INR consideration or TDS.
//
// Taxable TDS is calculated only when a later valuation/disposition layer
// provides sufficient evidence.
// ---------------------------------------------------------------------------

export function reconcileWallet(walletRows = []) {
  const rows = Array.isArray(walletRows) ? walletRows : [];

  const incoming = rows.filter((r) => r.type === "DEPOSIT");
  const outgoing = rows.filter((r) => r.type === "WITHDRAWAL");

  const manualVerification = rows
    .filter((r) => {
      const classification = r.transactionClassification;

      return (
        classification?.status === "UNDETERMINED" ||
        classification?.transferType === "VDA_MOVEMENT_OWNERSHIP_UNKNOWN"
      );
    })
    .map((r) => ({
      type: "OWNERSHIP_UNKNOWN",
      refId: r.refId,
      date: r.date,
      asset: r.asset,
      amount: r.amount,
      direction: r.type === "DEPOSIT" ? "IN" : "OUT",
      message:
        `${r.amount} ${r.asset} ${r.type === "DEPOSIT" ? "received" : "sent"} ` +
        `by the wallet, but source/destination ownership could not be established ` +
        `from the available on-chain data.`,
    }));

  const assetSummaryMap = {};

  for (const row of rows) {
    const key = row.asset || "UNKNOWN";

    if (!assetSummaryMap[key]) {
      assetSummaryMap[key] = {
        asset: key,
        incomingAmount: 0,
        outgoingAmount: 0,
        transactionCount: 0,
      };
    }

    const summary = assetSummaryMap[key];
    summary.transactionCount += 1;

    if (row.type === "DEPOSIT") {
      summary.incomingAmount += Number(row.amount) || 0;
    }

    if (row.type === "WITHDRAWAL") {
      summary.outgoingAmount += Number(row.amount) || 0;
    }
  }

  const assetSummary = Object.values(assetSummaryMap).map((item) => ({
    ...item,
    incomingAmount: Number(item.incomingAmount.toFixed(12)),
    outgoingAmount: Number(item.outgoingAmount.toFixed(12)),
  }));

  return {
    mode: "DECENTRALIZED_WALLET",

    transactionCount: rows.length,

    incomingCount: incoming.length,
    outgoingCount: outgoing.length,

    taxableTransactionCount: rows.filter(
      (r) => r.transactionClassification?.isVdaTransfer === true
    ).length,

    manualVerificationCount: manualVerification.length,

    expectedTds: 0,
    reportedTds: 0,
    tdsGap: 0,

    tdsStatus: "NOT_DETERMINED",

    reason:
      rows.length === 0
        ? "No observable on-chain wallet transactions were found."
        : manualVerification.length > 0
        ? "Wallet movements were observed, but ownership or taxable disposition could not be established for all movements."
        : "Wallet movements were observed. Taxable disposition and INR consideration require sufficient on-chain valuation evidence.",

    assetSummary,

    manualVerification,
  };
}