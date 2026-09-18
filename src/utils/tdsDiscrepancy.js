// ---------------------------------------------------------------------------
// Deterministic TDS discrepancy engine.
//
// This is part of the RULE ENGINE, not the AI layer — it decides what a
// discrepancy is and how large it is. The AI (services/complianceAssistant.js)
// only ever explains numbers this module already computed; it never
// recalculates or overrides them. Keeping this split explicit is the core
// architectural rule requested for the explainability upgrade:
//
//   "The rule engine decides compliance. AI explains compliance."
//
// Rule: under Section 194S, exchanges must deduct 1% TDS on the INR value
// of every SELL. `expectedTds` is that 1% figure. `reportedTds` is what the
// data says actually happened:
//   - if the CSV supplied an explicit tds_amount, use it directly
//   - otherwise fall back to the tds_status flag: DEDUCTED assumes the
//     full expected amount was collected, anything else assumes 0
// ---------------------------------------------------------------------------

const TDS_RATE = 0.01;

// Computes expected/reported TDS for EVERY sell, not just the ones that
// turn out to be discrepancies. Needed separately from
// computeTdsDiscrepancies() below because "TDS coverage" (reported ÷
// expected across the whole report) must be measured against the full
// picture — measuring it only over the already-flagged bad transactions
// guarantees a near-0% result regardless of how compliant everything else
// is, which is exactly the bug that made "Overall compliance confidence"
// misleadingly low whenever even a single discrepancy existed.
export function computeAllTdsRows(allRows) {
  const sells = allRows.filter((r) => r.type === "SELL");

  return sells.map((t) => {
    const expectedTds = Math.round(t.inrValue * TDS_RATE * 100) / 100;

    let reportedTds;
    let reportedSource;
    if (typeof t.tdsAmount === "number" && !Number.isNaN(t.tdsAmount)) {
      reportedTds = t.tdsAmount;
      reportedSource = "tds_amount column";
    } else if (t.tdsStatus === "DEDUCTED") {
      reportedTds = expectedTds;
      reportedSource = "tds_status=DEDUCTED (assumed full amount, no tds_amount column provided)";
    } else {
      reportedTds = 0;
      reportedSource = `tds_status=${t.tdsStatus}`;
    }

    const difference = Math.round((expectedTds - reportedTds) * 100) / 100;

    let riskTier = "low";
    if (expectedTds > 0) {
      const gapPct = Math.abs(difference) / expectedTds;
      if (gapPct > 0.5) riskTier = "high";
      else if (gapPct > 0.05) riskTier = "medium";
    }

    return {
      transactionId: t.refId,
      exchange: t.exchange,
      asset: t.asset,
      quantity: t.amount,
      type: t.type,
      date: t.date,
      inrValue: t.inrValue,
      expectedTds,
      reportedTds,
      reportedSource,
      difference,
      hasDiscrepancy: Math.abs(difference) > 0.5, // ignore sub-rupee rounding noise
      riskTier,
    };
  });
}

// The filtered view used for display (discrepancy cards) — unchanged
// behavior from before, just built on top of computeAllTdsRows now.
export function computeTdsDiscrepancies(allRows) {
  return computeAllTdsRows(allRows).filter((d) => d.hasDiscrepancy);
}
