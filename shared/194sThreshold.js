import { SECTION_194S_RULES } from "./taxRules.js";

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function thresholdForCategory(category) {
  if (category === SECTION_194S_RULES.deductorCategories.SPECIFIED_PERSON) {
    return SECTION_194S_RULES.thresholdInr.specifiedPerson;
  }
  if (category === SECTION_194S_RULES.deductorCategories.OTHER_PERSON) {
    return SECTION_194S_RULES.thresholdInr.otherPerson;
  }
  return null;
}

function thresholdResult(aggregation) {
  const category = aggregation.deductorCategory;
  const threshold = thresholdForCategory(category);
  const previous = finiteNumber(aggregation.previousFyConsideration);
  const current = finiteNumber(aggregation.currentTransactionConsideration);
  const cumulative = finiteNumber(aggregation.cumulativeFyConsideration);

  const result = {
    previous_fy_consideration: previous,
    current_consideration: current,
    cumulative_fy_consideration: cumulative,
    is_194s_applicable: null,
    threshold_amount: threshold,
    threshold_crossed: null,
    remaining_threshold_before_transaction:
      threshold == null || previous == null ? null : Math.max(0, threshold - previous),
    threshold_exceeded_amount: null,
    threshold_status: "REVIEW_REQUIRED",
    threshold_reason: "Threshold eligibility requires manual review.",
  };

  if (category === SECTION_194S_RULES.deductorCategories.UNKNOWN || threshold == null) {
    result.threshold_reason = "Deductor category is unknown; threshold eligibility requires review.";
    return result;
  }

  if (aggregation.financialYear == null) {
    result.threshold_reason = "Transaction financial year is unresolved; threshold eligibility requires review.";
    return result;
  }

  if (aggregation.identity == null) {
    result.threshold_reason = "Deductor identity is unavailable; threshold eligibility requires review.";
    return result;
  }

  if (previous == null || current == null || cumulative == null) {
    result.threshold_reason = "FY consideration is incomplete; threshold eligibility requires review.";
    return result;
  }

  if (aggregation.reviewRequired) {
    result.threshold_reason = "FY consideration is not sufficiently determined; threshold eligibility requires review.";
    return result;
  }

  const alreadyCrossed = previous > threshold;
  const crossedOnTransaction = previous <= threshold && cumulative > threshold;
  const applicable = cumulative > threshold;

  result.is_194s_applicable = applicable;
  result.threshold_crossed = crossedOnTransaction;
  result.threshold_exceeded_amount = Math.max(0, cumulative - threshold);

  if (alreadyCrossed) {
    result.threshold_status = "ALREADY_CROSSED";
    result.threshold_reason = "The applicable threshold was exceeded by an earlier transaction in this FY.";
  } else if (crossedOnTransaction) {
    result.threshold_status = "THRESHOLD_CROSSED";
    result.threshold_reason = "Cumulative FY consideration exceeded the applicable threshold on this transaction.";
  } else {
    result.threshold_status = "BELOW_THRESHOLD";
    result.threshold_reason = "Cumulative FY consideration does not exceed the applicable threshold.";
  }

  return result;
}

export function apply194sThresholdEligibility(rows) {
  return rows.map((row) => {
    const aggregation = row.financialYearAggregation;
    if (!aggregation?.included) return row;

    return {
      ...row,
      ...thresholdResult(aggregation),
    };
  });
}