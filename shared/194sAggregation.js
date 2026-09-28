import { SECTION_194S_RULES } from "./taxRules.js";
import { getIndianFinancialYear } from "./financialYear.js";

const DEDUCTOR_CATEGORIES = new Set(
  Object.values(SECTION_194S_RULES.deductorCategories)
);

function transactionTimestamp(row) {
  return row.timestamp ?? row.date ?? row.txDate ?? row.tx_date ?? null;
}

function timestampMillis(timestamp) {
  if (timestamp == null) return null;
  try {
    const millis = (timestamp instanceof Date ? timestamp : new Date(timestamp)).getTime();
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function transactionReference(row) {
  for (const value of [row.refId, row.transactionId, row.txHash, row.transactionHash]) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function identityValue(value) {
  if (value && typeof value === "object") {
    value = value.id ?? value.externalId ?? value.address ?? null;
  }
  if (value == null || !String(value).trim()) return null;
  return String(value).trim();
}

function aggregationIdentity(row, context) {
  const counterparty = identityValue(
    row.deductorId ?? row.counterpartyId ?? row.counterparty
  );
  if (counterparty) return { type: "counterparty", value: counterparty };

  const taxpayer = identityValue(
    context.taxpayerId ?? row.taxpayerId ?? row.taxpayer_id
  );
  return taxpayer ? { type: "taxpayer", value: taxpayer } : null;
}

function deductorCategory(row, context) {
  const explicitCategory = String(
    row.deductorCategory ?? context.deductorCategory ?? ""
  ).trim().toLowerCase();
  return DEDUCTOR_CATEGORIES.has(explicitCategory)
    ? explicitCategory
    : SECTION_194S_RULES.deductorCategories.UNKNOWN;
}

function considerationInr(row) {
  const value = row.consideration
    ? row.consideration.inrValue
    : row.inrValue;
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function qualifiesForAggregation(row) {
  return row.type === "SELL" && row.transactionClassification?.isVdaTransfer === true;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

export function aggregate194sConsideration(rows, context = {}) {
  const annotations = new Map();
  const candidates = rows
    .map((row, index) => ({ row, index, millis: timestampMillis(transactionTimestamp(row)) }))
    .filter(({ row }) => qualifiesForAggregation(row))
    .sort((left, right) => {
      if (left.millis == null && right.millis != null) return 1;
      if (left.millis != null && right.millis == null) return -1;
      return (left.millis ?? 0) - (right.millis ?? 0) || left.index - right.index;
    });

  const seenTransactions = new Set();
  const totalsByIdentityAndFy = new Map();

  for (const { row, index } of candidates) {
    const reference = transactionReference(row);
    if (reference && seenTransactions.has(reference)) {
      annotations.set(index, {
        included: false,
        exclusionReason: "DUPLICATE_TRANSACTION",
        status: "EXCLUDED",
        reviewRequired: false,
      });
      continue;
    }
    if (reference) seenTransactions.add(reference);

    const financialYear = getIndianFinancialYear(transactionTimestamp(row));
    const identity = aggregationIdentity(row, context);
    const category = deductorCategory(row, context);
    const currentConsideration = considerationInr(row);
    const hasAggregationKey = financialYear != null && identity != null;
    const aggregateKey = hasAggregationKey
      ? JSON.stringify([identity.type, identity.value.toLowerCase(), financialYear])
      : null;

    let previousConsideration = null;
    let cumulativeConsideration = null;
    if (aggregateKey) {
      const total = totalsByIdentityAndFy.get(aggregateKey) || {
        amount: 0,
        unresolved: false,
      };
      previousConsideration = total.unresolved ? null : total.amount;
      if (currentConsideration != null && !total.unresolved) {
        cumulativeConsideration = roundMoney(previousConsideration + currentConsideration);
        total.amount = cumulativeConsideration;
      } else {
        total.amount = null;
        total.unresolved = true;
      }
      totalsByIdentityAndFy.set(aggregateKey, total);
    }

    const reviewRequired =
      category === SECTION_194S_RULES.deductorCategories.UNKNOWN ||
      financialYear == null ||
      identity == null ||
      currentConsideration == null ||
      row.consideration?.determined === false;

    annotations.set(index, {
      included: true,
      financialYear,
      identity,
      deductorCategory: category,
      previousFyConsideration: previousConsideration,
      currentTransactionConsideration: currentConsideration,
      cumulativeFyConsideration: cumulativeConsideration,
      status: reviewRequired ? "REVIEW_REQUIRED" : "AGGREGATED",
      reviewRequired,
    });
  }

  return rows.map((row, index) => {
    if (!annotations.has(index)) return row;
    return {
      ...row,
      financialYearAggregation: annotations.get(index),
    };
  });
}