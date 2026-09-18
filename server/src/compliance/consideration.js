// ---------------------------------------------------------------------------
// Deterministic Section 194S consideration determination.
//
// The tax engine must not blindly treat an input `inr_value` as determined
// consideration. It first uses transaction economics (price / FX / received
// VDA FMV). If those fields are absent, the caller may provide a clearly
// labeled cross-record reference valuation. A source-file `inr_value` is only
// an UNVERIFIED fallback.
//
// Missing consideration is represented by null, never by 0.
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

export function determineConsideration(row, context = {}) {
  const quantity = finiteNumber(row.amount);
  const quoteCurrency = getQuoteCurrency(row);
  const unitPrice = getUnitPrice(row);
  const reportedInrValue = finiteNumber(row.inrValue ?? row.inr_value);

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
      reportedInrValue,
      valuationStatus: "DETERMINED",
      considerationType: "VDA_TO_VDA",
      method: "received_vda_fmv",
      source: "receivedAmount × receivedAssetFmvInrPerUnit",
      currency: "INR",
      valuationDifference:
        reportedInrValue == null ? null : roundMoney(reportedInrValue - inrValue),
      components: {
        receivedAsset: row.receivedAsset || row.received_asset || null,
        receivedAmount,
        receivedAssetFmvInrPerUnit: receivedAssetFmvInr,
      },
    };
  }

  // VDA -> INR / foreign currency: quantity × unit price, with FX when
  // the quote currency is not INR.
  if (quantity != null && unitPrice != null) {
    const fxRate = getFxRate(row, quoteCurrency || "INR");

    if (quoteCurrency === "INR" || !quoteCurrency) {
      const inrValue = roundMoney(quantity * unitPrice);
      const difference =
        reportedInrValue == null ? null : roundMoney(reportedInrValue - inrValue);
      const matches =
        difference == null || Math.abs(difference) <= Math.max(1, Math.abs(inrValue) * 0.001);

      return {
        determined: true,
        inrValue,
        reportedInrValue,
        valuationStatus: reportedInrValue == null
          ? "DETERMINED"
          : matches
          ? "VALIDATED"
          : "MISMATCH",
        considerationType: "VDA_TO_INR",
        method: "quantity_times_inr_unit_price",
        source: "amount × price",
        currency: "INR",
        valuationDifference: difference,
        components: { quantity, unitPriceInr: unitPrice },
      };
    }

    if (fxRate != null) {
      const foreignValue = roundMoney(quantity * unitPrice);
      const inrValue = roundMoney(foreignValue * fxRate);
      const difference =
        reportedInrValue == null ? null : roundMoney(reportedInrValue - inrValue);
      const matches =
        difference == null || Math.abs(difference) <= Math.max(1, Math.abs(inrValue) * 0.001);

      return {
        determined: true,
        inrValue,
        reportedInrValue,
        valuationStatus: reportedInrValue == null
          ? "DETERMINED"
          : matches
          ? "VALIDATED"
          : "MISMATCH",
        considerationType: "VDA_TO_FOREIGN_CURRENCY",
        method: "quantity_times_foreign_price_times_fx",
        source: "amount × price × fxRateInr",
        currency: "INR",
        valuationDifference: difference,
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

  // Cross-record reference valuation. This is intentionally explicit:
  // another uploaded row is a reference, not the transaction's own
  // consideration. It is useful for audit/reconciliation when a source row
  // omitted its price, and it flags a supplied value that disagrees.
  const referenceUnitPriceInr = finiteNumber(context.referenceUnitPriceInr);
  const transactionType = String(row.type || "").trim().toUpperCase();
  if (transactionType === "SELL" && quantity != null && referenceUnitPriceInr != null) {
    const inrValue = roundMoney(quantity * referenceUnitPriceInr);
    const difference =
      reportedInrValue == null ? null : roundMoney(reportedInrValue - inrValue);
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
      source: context.referenceSource || "cross-record reference",
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

  // A reported INR value is retained for backwards compatibility, but it is
  // explicitly unverified when no independent valuation is available.
  if (reportedInrValue != null) {
    return {
      determined: false,
      inrValue: roundMoney(reportedInrValue),
      reportedInrValue: roundMoney(reportedInrValue),
      valuationStatus: "UNVERIFIED",
      considerationType: "UNKNOWN",
      method: "provided_inr_value_fallback",
      source: "input inr_value",
      currency: "INR",
      valuationDifference: 0,
      components: { suppliedInrValue: roundMoney(reportedInrValue) },
    };
  }

  return {
    determined: false,
    inrValue: null,
    reportedInrValue: null,
    valuationStatus: "UNRESOLVED",
    considerationType: "UNKNOWN",
    method: "undetermined",
    source: "insufficient transaction valuation fields",
    currency: "INR",
    valuationDifference: null,
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
