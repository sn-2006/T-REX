/*
 * Generic TDS discrepancy engine.
 *
 * Important rules:
 * - Only SELL transactions are evaluated for sale-level TDS.
 * - Transfers are not automatically treated as sales.
 * - Missing TDS amount is not silently treated as deducted.
 * - NOT_APPLICABLE is reported separately.
 * - Missing valuation produces an unresolved result.
 * - The TDS rate is configurable.
 * - No exchange-specific or asset-specific logic is used.
 */

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const number = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[₹$€£]/g, "")
      .trim()
  );

  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getType(row) {
  return upper(row.type || row._type);
}

function getConsideration(row) {
  return row.consideration || null;
}

function getSaleValue(row) {
  const consideration = getConsideration(row);

  return toNumber(
    consideration?.inrValue ??
      row.inrValue ??
      row.inr_value ??
      row.totalInr ??
      row.total_inr
  );
}

function getReportedTds(row) {
  return toNumber(
    row.tdsAmount ??
      row.tds_amount ??
      row.reportedTds ??
      row.reported_tds
  );
}

function getTdsStatus(row) {
  return upper(
    row.tdsStatus ??
      row.tds_status ??
      row.taxStatus ??
      row.tax_status
  );
}

function getTransactionId(row, index) {
  return (
    row.refId ??
    row.ref_id ??
    row.transactionId ??
    row.transaction_id ??
    row.id ??
    `ROW_${index + 1}`
  );
}

function getRate(options = {}) {
  const rate = toNumber(
    options.tdsRate ??
      options.rate ??
      0.01
  );

  if (rate === null || rate < 0) {
    return 0.01;
  }

  return rate;
}

// ---------------------------------------------------------
// TDS status evaluation
// ---------------------------------------------------------

function evaluateTdsStatus({
  expectedTds,
  reportedTds,
  sourceStatus,
  valuationStatus,
  saleValue,
}) {
  if (saleValue === null) {
    return {
      status: "MISSING_SALE_VALUE",
      requiresReview: true,
      reason:
        "The sale value could not be determined from the available data.",
    };
  }

  if (valuationStatus === "MISMATCH") {
    return {
      status: "VALUATION_MISMATCH",
      requiresReview: true,
      reason:
        "The reported and determined transaction values differ.",
    };
  }

  if (sourceStatus === "NOT_APPLICABLE") {
    return {
      status: "MARKED_NOT_APPLICABLE",
      requiresReview: expectedTds > 0,
      reason:
        "The source row marks TDS as not applicable.",
    };
  }

  if (reportedTds === null) {
    return {
      status: "MISSING_REPORTED_TDS",
      requiresReview: true,
      reason:
        "No reported TDS amount was supplied for this sale.",
    };
  }

  const difference = roundMoney(
    expectedTds - reportedTds
  );

  if (Math.abs(difference) <= 0.01) {
    return {
      status: "MATCHED",
      requiresReview: false,
      reason:
        "Reported TDS is within the allowed rounding tolerance.",
    };
  }

  return {
    status: "TDS_MISMATCH",
    requiresReview: true,
    reason:
      "Expected TDS and reported TDS differ.",
  };
}

// ---------------------------------------------------------
// Risk classification
// ---------------------------------------------------------

function calculateRiskTier({
  expectedTds,
  reportedTds,
  status,
}) {
  if (
    status === "MISSING_SALE_VALUE" ||
    status === "MISSING_REPORTED_TDS" ||
    status === "VALUATION_MISMATCH"
  ) {
    return "REVIEW_REQUIRED";
  }

  if (status === "MARKED_NOT_APPLICABLE") {
    return "REVIEW_REQUIRED";
  }

  if (
    expectedTds === null ||
    reportedTds === null ||
    expectedTds <= 0
  ) {
    return "UNKNOWN";
  }

  const difference = Math.abs(
    expectedTds - reportedTds
  );

  const percentage = difference / expectedTds;

  if (percentage > 0.5) {
    return "HIGH";
  }

  if (percentage > 0.05) {
    return "MEDIUM";
  }

  return "LOW";
}

// ---------------------------------------------------------
// One-row calculation
// ---------------------------------------------------------

export function computeTdsForRow(row, options = {}) {
  const rate = getRate(options);
  const type = getType(row);

  const saleValue = getSaleValue(row);
  const reportedTds = getReportedTds(row);
  const sourceStatus = getTdsStatus(row);

  const consideration = getConsideration(row);

  /*
   * Only SELL rows are eligible for this sale-level TDS engine.
   * BUY, DEPOSIT, WITHDRAWAL, and TRANSFER rows are not treated
   * as taxable sales here.
   */
  if (type !== "SELL") {
    return {
      transactionId: row.refId ?? row.ref_id ?? null,
      exchange: row.exchange ?? null,
      asset: row.asset ?? null,
      date: row.date ?? row.timestamp ?? null,

      type,
      isSale: false,

      saleValueInr: null,
      expectedTds: 0,
      reportedTds: reportedTds ?? 0,
      difference: 0,

      status: "NOT_A_SALE",
      requiresReview: false,
      riskTier: "NONE",

      reportedSource:
        reportedTds === null
          ? "not applicable"
          : "tds amount field",

      consideration,
      transactionClassification:
        row.transactionClassification ?? null,
    };
  }

  const valuationStatus =
    consideration?.valuationStatus ??
    "UNVERIFIED";

  const expectedTds =
    saleValue === null
      ? null
      : roundMoney(saleValue * rate);

  const evaluation = evaluateTdsStatus({
    expectedTds,
    reportedTds,
    sourceStatus,
    valuationStatus,
    saleValue,
  });

  const difference =
    expectedTds === null || reportedTds === null
      ? null
      : roundMoney(expectedTds - reportedTds);

  return {
    transactionId:
      row.refId ??
      row.ref_id ??
      row.transactionId ??
      row.transaction_id ??
      null,

    exchange: row.exchange ?? null,
    asset: row.asset ?? null,
    date: row.date ?? row.timestamp ?? null,

    type,
    isSale: true,

    quantity:
      toNumber(row.amount) ??
      toNumber(row.quantity) ??
      null,

    saleValueInr: saleValue,

    expectedTds,
    reportedTds,
    difference,

    rate,

    sourceTdsStatus:
      sourceStatus || "UNKNOWN",

    status: evaluation.status,
    requiresReview: evaluation.requiresReview,
    reason: evaluation.reason,

    riskTier: calculateRiskTier({
      expectedTds,
      reportedTds,
      status: evaluation.status,
    }),

    reportedSource:
      reportedTds === null
        ? "missing tds amount"
        : "tds amount field",

    consideration,

    transactionClassification:
      row.transactionClassification ?? null,
  };
}

// ---------------------------------------------------------
// All-row calculation
// ---------------------------------------------------------

export function computeAllTdsRows(
  allRows,
  options = {}
) {
  const rows = Array.isArray(allRows)
    ? allRows
    : [];

  return rows.map((row) =>
    computeTdsForRow(row, options)
  );
}

// ---------------------------------------------------------
// Only discrepancy rows
// ---------------------------------------------------------

export function computeTdsDiscrepancies(
  allRows,
  options = {}
) {
  return computeAllTdsRows(
    allRows,
    options
  ).filter(
    (row) =>
      row.isSale &&
      row.requiresReview
  );
}

// ---------------------------------------------------------
// Summary calculation
// ---------------------------------------------------------

export function computeTdsSummary(
  allRows,
  options = {}
) {
  const rows = computeAllTdsRows(
    allRows,
    options
  );

  const sales = rows.filter(
    (row) => row.isSale
  );

  const expectedTds = sales.reduce(
    (total, row) =>
      total +
      (Number.isFinite(row.expectedTds)
        ? row.expectedTds
        : 0),
    0
  );

  const reportedTds = sales.reduce(
    (total, row) =>
      total +
      (Number.isFinite(row.reportedTds)
        ? row.reportedTds
        : 0),
    0
  );

  const discrepancies = sales.filter(
    (row) => row.requiresReview
  );

  return {
    saleCount: sales.length,

    expectedTds: roundMoney(expectedTds),
    reportedTds: roundMoney(reportedTds),
    difference: roundMoney(
      expectedTds - reportedTds
    ),

    matchedCount: sales.filter(
      (row) => row.status === "MATCHED"
    ).length,

    discrepancyCount: discrepancies.length,

    missingReportedTdsCount: sales.filter(
      (row) =>
        row.status === "MISSING_REPORTED_TDS"
    ).length,

    notApplicableCount: sales.filter(
      (row) =>
        row.status === "MARKED_NOT_APPLICABLE"
    ).length,

    valuationMismatchCount: sales.filter(
      (row) =>
        row.status === "VALUATION_MISMATCH"
    ).length,

    missingSaleValueCount: sales.filter(
      (row) =>
        row.status === "MISSING_SALE_VALUE"
    ).length,

    requiresReview: discrepancies.length > 0,

    rate: getRate(options),
  };
}