import { daysBetween } from "./parseExchange";

// Runs the core ChainTDS reconciliation logic across all uploaded exchange
// transactions (and, optionally, on-chain wallet transfers).
// Returns: { tradeSummary, transferChecks, warnings }
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
    s.totalInr += t.inrValue;
    if (t.tdsStatus === "DEDUCTED") s.tdsDeductedCount += 1;
  }
  const tradeSummary = Object.values(summaryMap);

  // 2. Transfer check — match withdrawals on one exchange to deposits on
  // another for the same asset, within a 5-day window. This is the
  // cross-platform check no single exchange can do on its own.
  const transferChecks = [];
  const matchedWithdrawalIds = new Set();
  const matchedDepositIds = new Set();

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

  return { tradeSummary, transferChecks, warnings };
}
