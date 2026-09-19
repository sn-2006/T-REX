// ---------------------------------------------------------------------------
// Deterministic Section 194S consideration determination.
//
// Priority:
//   1. VDA -> VDA: received VDA amount × received-VDA INR FMV
//   2. VDA -> INR: quantity × INR unit price
//   3. VDA -> foreign currency: quantity × foreign unit price × INR FX rate
//   4. Explicit cross-record reference valuation supplied by the caller
//   5. Reported `inr_value` as an UNVERIFIED fallback
//
// Missing consideration is never converted to ₹0. Unknown is represented by
// null so the 194S layer cannot silently calculate tax on a zero value.
// ---------------------------------------------------------------------------

import { withTransactionClassification } from "./transactionClassifier.js";

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function getQuoteCurrency(row) {
  return normalizeCurrency(
    row.quoteCurrency || row.quote_asset || row.quoteAsset || row.priceCurrency || row.price_currency
  );
}

function getUnitPrice(row) {
  return finiteNumber(row.unitPrice ?? row.price ?? row.unit_price);
}

function getFxRate(row, currency) {
  if (currency === "INR") return 1;
  return finiteNumber(
    row.fxRateInr ?? row.fx_rate_inr ?? row.inrPerQuoteUnit ?? row.inr_per_quote_unit
  );
}

/** Determine consideration for one normalized transaction row. */
export function determineConsideration(row, context = {}) {
  const quantity = finiteNumber(row.amount);
  const quoteCurrency = getQuoteCurrency(row);
  const unitPrice = getUnitPrice(row);

  // VDA -> VDA: value the VDA received using its INR FMV per unit.
  const receivedAmount = finiteNumber(
    row.receivedAmount ?? row.received_amount ?? row.quoteAmount
  );
  const receivedAssetFmvInr = finiteNumber(
    row.receivedAssetFmvInrPerUnit ??
      row.received_asset_fmv_inr_per_unit ??
      row.receivedFmvInrPerUnit ??
      row.received_fmv_inr_per_unit
  );

  if (receivedAmount != null && receivedAssetFmvInr != null) {
    const inrValue = roundMoney(receivedAmount * receivedAssetFmvInr);
    return {
      determined: true,
      inrValue,
      reportedInrValue: finiteNumber(row.inrValue ?? row.inr_value),
      valuationStatus: row.valuationStatus || "DETERMINED",
      considerationType: "VDA_TO_VDA",
      method: "received_vda_fmv",
      source: "receivedAmount × receivedAssetFmvInrPerUnit",
      currency: "INR",
      actualInrReceived: row.actualInrReceived ?? null,
      estimatedInrValue: row.estimatedInrValue ?? inrValue,
      valuationEvidence: row.valuationEvidence || null,
      components: {
        receivedAsset: row.receivedAsset || row.received_asset || null,
        receivedAmount,
        receivedAssetFmvInrPerUnit: receivedAssetFmvInr,
      },
    };
  }

  // VDA -> INR / foreign currency: calculate consideration from quantity and
  // unit price, then convert to INR when the quote currency is foreign.
  if (quantity != null && unitPrice != null) {
    const fxRate = getFxRate(row, quoteCurrency || "INR");

    if (quoteCurrency === "INR" || !quoteCurrency) {
      const inrValue = roundMoney(quantity * unitPrice);
      return {
        determined: true,
        inrValue,
        reportedInrValue: finiteNumber(row.inrValue ?? row.inr_value),
        valuationStatus: "VALIDATED",
        considerationType: "VDA_TO_INR",
        method: "quantity_times_inr_unit_price",
        source: "amount × price",
        currency: "INR",
        components: { quantity, unitPriceInr: unitPrice },
      };
    }

    if (fxRate != null) {
      const foreignValue = roundMoney(quantity * unitPrice);
      const inrValue = roundMoney(foreignValue * fxRate);
      return {
        determined: true,
        inrValue,
        reportedInrValue: finiteNumber(row.inrValue ?? row.inr_value),
        valuationStatus: "DETERMINED",
        considerationType: "VDA_TO_FOREIGN_CURRENCY",
        method: "quantity_times_foreign_price_times_fx",
        source: "amount × price × fxRateInr",
        currency: "INR",
        components: {
          quantity,
          unitPriceForeign: unitPrice,
          foreignCurrency: quoteCurrency,
          foreignConsideration: foreignValue,
          fxRateInr: fxRate,
        },
      };
    }
  }

  // A caller can provide an independently selected reference unit price,
  // e.g. a transaction-time market/reference price resolved from the complete
  // uploaded ledger. This is deliberately labeled as a reference rather than
  // pretending that another row's reported INR value is the transaction's
  // actual consideration.
  const referenceUnitPriceInr = finiteNumber(context.referenceUnitPriceInr);
  const transactionType = String(row.type || "").trim().toUpperCase();
  if (transactionType === "SELL" && quantity != null && referenceUnitPriceInr != null) {
    const inrValue = roundMoney(quantity * referenceUnitPriceInr);
    const reportedInrValue = finiteNumber(row.inrValue ?? row.inr_value);
    const difference =
      reportedInrValue == null
        ? null
        : roundMoney(reportedInrValue - inrValue);
    const matches =
      difference == null || Math.abs(difference) <= Math.max(1, Math.abs(inrValue) * 0.001);

    return {
      determined: true,
      inrValue,
      reportedInrValue,
      valuationStatus: reportedInrValue == null
        ? "REFERENCE_DETERMINED"
        : matches
        ? "VALIDATED"
        : "MISMATCH",
      considerationType: "VDA_TO_INR",
      method: "quantity_times_reference_unit_price",
      source: context.referenceSource || "reference valuation",
      currency: "INR",
      valuationDifference: difference,
      components: {
        quantity,
        referenceUnitPriceInr,
        referenceDate: context.referenceDate || null,
        referenceTransactionId: context.referenceTransactionId || null,
      },
    };
  }

  // Backwards-compatible legacy input. It remains usable, but is explicitly
  // marked as UNVERIFIED because there is no independent valuation evidence.
  const suppliedInrValue = finiteNumber(row.inrValue ?? row.inr_value);
  if (suppliedInrValue != null) {
    return {
      determined: false,
      inrValue: roundMoney(suppliedInrValue),
      reportedInrValue: roundMoney(suppliedInrValue),
      valuationStatus: "UNVERIFIED",
      considerationType: "UNKNOWN",
      method: "provided_inr_value_fallback",
      source: "input inr_value",
      currency: "INR",
      components: { suppliedInrValue: roundMoney(suppliedInrValue) },
    };
  }

  return {
    determined: false,
    inrValue: null,
    reportedInrValue: null,
    valuationStatus: row.valuationStatus === "PENDING_VALUATION"
      ? "PENDING_VALUATION"
      : "UNRESOLVED",
    considerationType: "UNKNOWN",
    method: "undetermined",
    source: "insufficient transaction valuation fields",
    currency: "INR",
    components: {},
  };
}

export function withDeterminedConsideration(row, context = {}) {
  const classifiedRow = row.transactionClassification
    ? row
    : withTransactionClassification(row);
  const consideration = determineConsideration(classifiedRow, context);
  return {
    ...classifiedRow,
    inrValue: consideration.inrValue,
    consideration,
  };
}
