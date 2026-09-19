import { withTransactionClassification } from "./transactionClassifier.js";
import { withDeterminedConsideration } from "./consideration.js";

const TDS_RATE = 0.01;

function finiteNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sumKnownTds(rows, field) {
  if (rows.some((row) => row[field] == null)) return null;
  return Math.round(rows.reduce((sum, row) => sum + row[field], 0) * 100) / 100;
}

function buildReferenceCandidates(rows) {
  const candidates = [];

  rows.forEach((row, index) => {
    if (String(row.type || "").toUpperCase() !== "SELL") return;

    const asset = String(row.asset || "").trim().toUpperCase();
    const amount = finiteNumber(row.amount);
    const reported = finiteNumber(row.inrValue ?? row.inr_value);

    if (!asset || amount == null || amount <= 0 || reported == null || reported <= 0) return;

    candidates.push({
      asset,
      unitPriceInr: reported / amount,
      date: row.date || null,
      transactionId: row.refId || null,
      index,
    });
  });

  // Stable baseline: earliest valid source-record valuation for each asset.
  // This is a reconciliation reference only; it is labeled as such in the
  // resulting consideration object and is never presented as an official
  // market price.
  const byAsset = new Map();
  for (const candidate of candidates) {
    const current = byAsset.get(candidate.asset);
    if (!current) {
      byAsset.set(candidate.asset, candidate);
      continue;
    }

    const currentDate = current.date ? new Date(current.date).getTime() : Infinity;
    const candidateDate = candidate.date ? new Date(candidate.date).getTime() : Infinity;

    if (
      candidateDate < currentDate ||
      (candidateDate === currentDate && candidate.index < current.index)
    ) {
      byAsset.set(candidate.asset, candidate);
    }
  }

  return byAsset;
}

function contextForRow(row, referenceCandidates) {
  if (String(row.type || "").trim().toUpperCase() !== "SELL") return {};
  const asset = String(row.asset || "").trim().toUpperCase();
  const reference = referenceCandidates.get(asset);

  if (!reference || reference.transactionId === row.refId) return {};

  return {
    referenceUnitPriceInr: reference.unitPriceInr,
    referenceDate: reference.date,
    referenceTransactionId: reference.transactionId,
    referenceSource: "earliest valid same-asset uploaded SELL",
  };
}

export function computeTdsRows(allRows) {
  const referenceCandidates = buildReferenceCandidates(allRows);

  return allRows
    .filter((r) => {
      const c = r.transactionClassification;
      return r.type === "SELL" && c?.isVdaTransfer === true;
    })
    .map((t) => {
      const consideration = t.consideration || {
        inrValue: finiteNumber(t.inrValue),
        determined: false,
        method: "legacy_row_without_consideration",
        considerationType: "UNKNOWN",
        source: "normalized inrValue",
        valuationStatus: "UNVERIFIED",
      };

      const expectedTds =
        consideration.inrValue == null
          ? null
          : Math.round(consideration.inrValue * TDS_RATE * 100) / 100;

      let reportedTds;
      let reportedSource;
      const decentralizedDerived = t.transactionSource === "DECENTRALIZED_DEX";

      if (typeof t.tdsAmount === "number" && Number.isFinite(t.tdsAmount)) {
        reportedTds = t.tdsAmount;
        reportedSource = "tds_amount column";
      } else if (expectedTds != null && t.tdsStatus === "DEDUCTED") {
        reportedTds = expectedTds;
        reportedSource = "tds_status=DEDUCTED (assumed full amount, no tds_amount column provided)";
      } else if (decentralizedDerived && t.tdsStatus === "NOT_REPORTED") {
        // A reconstructed on-chain event has an expected TDS value, but the
        // blockchain does not provide a reported TDS deduction. Do not turn
        // missing evidence into a false TDS mismatch.
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

      let riskTier = "low";
      if (expectedTds != null && expectedTds > 0) {
        const gapPct = Math.abs(difference) / expectedTds;
        if (gapPct > 0.5) riskTier = "high";
        else if (gapPct > 0.05) riskTier = "medium";
      }

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
        type: t.type,
        date: t.date,
        inrValue: consideration.inrValue,
        consideration,
        expectedTds,
        reportedTds,
        difference,
        status,
        reviewRequired: status === "REVIEW_REQUIRED",
        hasDiscrepancy:
          (difference != null && Math.abs(difference) > 0.5) || hasValuationDiscrepancy,
        hasTdsDiscrepancy: difference != null && Math.abs(difference) > 0.5,
        hasValuationDiscrepancy,
        riskTier,
        transactionClassification: t.transactionClassification,
        vdaTransferStatus: t.transactionClassification?.status ?? "UNDETERMINED",
        transferType: t.transactionClassification?.transferType ?? "UNCLASSIFIED",
        transferConfidence: t.transactionClassification?.confidence ?? 0,
      };
    });
}

export function analyzeRows(rows) {
  const classifiedRows = rows.map(withTransactionClassification);
  const referenceCandidates = buildReferenceCandidates(classifiedRows);

  const valuedRows = classifiedRows.map((row) =>
    withDeterminedConsideration(row, contextForRow(row, referenceCandidates))
  );

  const tdsRows = computeTdsRows(valuedRows);

  return {
    rows: valuedRows,
    tdsRows,
    discrepancies: tdsRows.filter((r) => r.hasDiscrepancy),
    summary: {
      totalRows: valuedRows.length,
      confirmedVdaTransfers: valuedRows.filter(
        (r) => r.transactionClassification?.isVdaTransfer === true
      ).length,
      nonTransfers: valuedRows.filter(
        (r) => r.transactionClassification?.isVdaTransfer === false
      ).length,
      undetermined: valuedRows.filter(
        (r) => r.transactionClassification?.isVdaTransfer == null
      ).length,
      tdsRows: tdsRows.length,
      discrepancies: tdsRows.filter((r) => r.hasDiscrepancy).length,
      expectedTds: sumKnownTds(tdsRows, "expectedTds"),
      reportedTds: sumKnownTds(tdsRows, "reportedTds"),
    },
  };
}
