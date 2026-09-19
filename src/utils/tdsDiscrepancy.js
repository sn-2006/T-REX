// ---------------------------------------------------------------------------
// Deterministic TDS discrepancy engine.
//
// The 194S calculation uses the consideration determined by the valuation
// engine. A valuation mismatch is also surfaced as a discrepancy so a
// source-file value cannot silently pass through merely because its TDS flag
// says DEDUCTED.
// ---------------------------------------------------------------------------

const TDS_RATE = 0.01;

export function computeAllTdsRows(allRows) {
  const eligibleTransfers = allRows.filter((r) => {
    const classification = r.transactionClassification;
    return r.type === "SELL" && classification?.isVdaTransfer === true;
  });

  return eligibleTransfers.map((t) => {
    const consideration = t.consideration || {
      inrValue:
        t.inrValue == null || !Number.isFinite(Number(t.inrValue))
          ? null
          : Number(t.inrValue),
      determined: false,
      method: "legacy_row_without_consideration",
      considerationType: "UNKNOWN",
      source: "normalized inrValue",
      valuationStatus: "UNVERIFIED",
      valuationDifference: null,
    };

    const expectedTds =
      consideration.inrValue == null
        ? null
        : Math.round(consideration.inrValue * TDS_RATE * 100) / 100;

    let reportedTds;
    let reportedSource;
    const decentralizedDerived = t.transactionSource === "DECENTRALIZED_DEX";
    if (typeof t.tdsAmount === "number" && !Number.isNaN(t.tdsAmount)) {
      reportedTds = t.tdsAmount;
      reportedSource = "tds_amount column";
    } else if (expectedTds != null && t.tdsStatus === "DEDUCTED") {
      reportedTds = expectedTds;
      reportedSource = "tds_status=DEDUCTED (assumed full amount, no tds_amount column provided)";
    } else if (decentralizedDerived && t.tdsStatus === "NOT_REPORTED") {
      reportedTds = null;
      reportedSource = "no reported TDS record in on-chain data";
    } else if (expectedTds == null || t.tdsStatus == null || t.tdsStatus === "NOT_REPORTED" || t.tdsStatus === "PENDING") {
      reportedTds = null;
      reportedSource = "expected or reported TDS evidence unavailable";
    } else {
      reportedTds = 0;
      reportedSource = `tds_status=${t.tdsStatus}`;
    }

    const difference =
      expectedTds == null || reportedTds == null
        ? null
        : Math.round((expectedTds - reportedTds) * 100) / 100;

    const valuationDifference = consideration.valuationDifference ?? null;
    const hasValuationDiscrepancy =
      consideration.valuationStatus === "MISMATCH" &&
      valuationDifference != null &&
      Math.abs(valuationDifference) > 0.5;
    const status =
      expectedTds == null || reportedTds == null
        ? "REVIEW_REQUIRED"
        : hasValuationDiscrepancy
          ? "VALUATION_MISMATCH"
          : difference != null && Math.abs(difference) > 0.5
            ? "TDS_MISMATCH"
            : "MATCHED";

    let riskTier = "low";
    if (expectedTds != null && expectedTds > 0) {
      const gapPct = Math.abs(difference) / expectedTds;
      if (gapPct > 0.5) riskTier = "high";
      else if (gapPct > 0.05) riskTier = "medium";
    }
    if (hasValuationDiscrepancy && riskTier === "low") {
      const valuationPct =
        consideration.inrValue > 0
          ? Math.abs(valuationDifference) / consideration.inrValue
          : 1;
      riskTier = valuationPct > 0.5 ? "high" : "medium";
    }

    return {
      transactionId: t.refId,
      exchange: t.exchange,
      asset: t.asset,
      quantity: t.amount,
      type:
  hasValuationDiscrepancy
    ? "VALUATION_MISMATCH"
    : difference != null && Math.abs(difference) > 0.5
      ? "TDS_MISMATCH"
      : null,
      date: t.date,
      inrValue: consideration.inrValue,
      consideration,
      expectedTds,
      reportedTds,
      reportedSource,
      difference,
      status,
      reviewRequired: status === "REVIEW_REQUIRED",
      hasTdsDiscrepancy: difference != null && Math.abs(difference) > 0.5,
      hasValuationDiscrepancy,
      hasDiscrepancy:
        (difference != null && Math.abs(difference) > 0.5) || hasValuationDiscrepancy,
      riskTier,
      transactionClassification: t.transactionClassification,
      vdaTransferStatus: t.transactionClassification?.status ?? "UNDETERMINED",
      transferType: t.transactionClassification?.transferType ?? "UNCLASSIFIED",
      transferConfidence: t.transactionClassification?.confidence ?? 0,
    };
  });
}

export function computeTdsDiscrepancies(allRows) {
  return computeAllTdsRows(allRows).filter((d) => d.hasDiscrepancy);
}
