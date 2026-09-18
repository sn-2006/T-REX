import { daysBetween } from "./parseExchange.js";

/*
 * Generic ChainTDS reconciliation engine.
 *
 * Responsibilities:
 * - Separate trades and transfers.
 * - Aggregate BUY/SELL transactions.
 * - Match cross-exchange withdrawals and deposits.
 * - Avoid forcing ambiguous transfer matches.
 * - Report missing or invalid data.
 * - Calculate sale-level TDS information when available.
 * - Keep transfers separate from taxable sales.
 *
 * This file does not contain exchange-specific or asset-specific logic.
 */

// ---------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[₹$€£]/g, "")
      .trim()
  );

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeType(value) {
  const type = upper(value).replace(/[\s-]+/g, "_");

  const aliases = {
    PURCHASE: "BUY",
    PURCHASE_ORDER: "BUY",
    BUY_ORDER: "BUY",
    BOUGHT: "BUY",

    SALE: "SELL",
    SELL_ORDER: "SELL",
    SOLD: "SELL",

    WITHDRAW: "WITHDRAWAL",
    WITHDRAWAL_COMPLETED: "WITHDRAWAL",
    SEND: "WITHDRAWAL",
    SENT: "WITHDRAWAL",
    TRANSFER_OUT: "WITHDRAWAL",

    DEPOSIT_COMPLETED: "DEPOSIT",
    RECEIVE: "DEPOSIT",
    RECEIVED: "DEPOSIT",
    TRANSFER_IN: "DEPOSIT",

    INTERNAL_TRANSFER: "TRANSFER",
    WALLET_TRANSFER: "TRANSFER",

    CONVERT: "SWAP",
    CONVERSION: "SWAP",
    EXCHANGE: "SWAP",

    FEES: "FEE",
    COMMISSION: "FEE",

    REWARD: "INCOME",
    AIRDROP: "INCOME",
    INTEREST: "INCOME",
    BONUS: "INCOME",
  };

  return aliases[type] || type || "UNKNOWN";
}

function normalizeAsset(value) {
  return upper(value);
}

function normalizeExchange(value) {
  return clean(value) || "UNKNOWN_EXCHANGE";
}

function getDate(row) {
  return row.date ?? row.timestamp ?? null;
}

function getAmount(row) {
  return toNumber(
    row.amount ??
      row.quantity ??
      row.qty ??
      row.volume ??
      row.executedAmount ??
      row.executed_quantity
  );
}

function getInrValue(row) {
  const value =
    row.consideration?.inrValue ??
    row.inrValue ??
    row.totalInr ??
    row.total_inr ??
    row.valueInr;

  return toNumber(value);
}

function getTdsAmount(row) {
  return toNumber(
    row.tdsAmount ??
      row.tds_amount ??
      row.reportedTds ??
      row.reported_tds
  );
}

function getRowId(row, index) {
  const explicitId =
    row.refId ??
    row.ref_id ??
    row.transactionId ??
    row.transaction_id ??
    row.id;

  if (clean(explicitId)) {
    return clean(explicitId);
  }

  return [
    normalizeExchange(row.exchange),
    getDate(row) ?? "NO_DATE",
    normalizeType(row.type),
    normalizeAsset(row.asset),
    getAmount(row) ?? "NO_AMOUNT",
    index,
  ].join("__");
}

function getDaysBetweenSafe(from, to) {
  if (!from || !to) {
    return Infinity;
  }

  try {
    const result = daysBetween(from, to);

    return isFiniteNumber(result) ? result : Infinity;
  } catch {
    return Infinity;
  }
}

function getDataQuality(row) {
  return Array.isArray(row.dataQuality)
    ? row.dataQuality
    : [];
}

function hasDataQualityIssue(row) {
  return (
    getDataQuality(row).length > 0 &&
    !getDataQuality(row).includes("OK")
  );
}

// ---------------------------------------------------------
// Normalization
// ---------------------------------------------------------

function normalizeRow(row, index) {
  const type = normalizeType(row.type);
  const asset = normalizeAsset(row.asset);
  const exchange = normalizeExchange(row.exchange);
  const amount = getAmount(row);
  const inrValue = getInrValue(row);
  const tdsAmount = getTdsAmount(row);
  const date = getDate(row);

  return {
    ...row,

    _rowId: getRowId(row, index),
    _type: type,
    _asset: asset,
    _exchange: exchange,
    _amount: amount,
    _inrValue: inrValue,
    _tdsAmount: tdsAmount,
    _date: date,

    _dataQuality: getDataQuality(row),
  };
}

// ---------------------------------------------------------
// Amount matching
// ---------------------------------------------------------

function amountsMatch(
  first,
  second,
  {
    absoluteTolerance = 0.0001,
    relativeTolerance = 0.001,
  } = {}
) {
  if (!isFiniteNumber(first) || !isFiniteNumber(second)) {
    return false;
  }

  const difference = Math.abs(first - second);

  const allowedDifference = Math.max(
    absoluteTolerance,
    Math.max(Math.abs(first), Math.abs(second)) *
      relativeTolerance
  );

  return difference <= allowedDifference;
}

// ---------------------------------------------------------
// Transfer scoring
// ---------------------------------------------------------

function scoreTransferCandidate(withdrawal, deposit) {
  const reasons = [];
  let score = 0;

  if (withdrawal._asset === deposit._asset) {
    score += 35;
    reasons.push("Same asset");
  }

  if (
    isFiniteNumber(withdrawal._amount) &&
    isFiniteNumber(deposit._amount)
  ) {
    if (amountsMatch(withdrawal._amount, deposit._amount)) {
      score += 35;
      reasons.push("Compatible quantity");
    }
  }

  const dayGap = getDaysBetweenSafe(
    withdrawal._date,
    deposit._date
  );

  if (dayGap !== Infinity && dayGap >= 0 && dayGap <= 5) {
    score += 20;
    reasons.push("Compatible timestamp");
  }

  if (
    withdrawal.transactionHash &&
    deposit.transactionHash &&
    upper(withdrawal.transactionHash) ===
      upper(deposit.transactionHash)
  ) {
    score += 10;
    reasons.push("Matching transaction hash");
  }

  if (
    withdrawal.destination &&
    deposit.source &&
    clean(withdrawal.destination) ===
      clean(deposit.source)
  ) {
    score += 10;
    reasons.push("Matching wallet addresses");
  }

  return {
    score: Math.min(score, 100),
    reasons,
    dayGap,
  };
}

// ---------------------------------------------------------
// Transfer matching
// ---------------------------------------------------------

function matchTransfers(withdrawals, deposits) {
  const matchedWithdrawalIds = new Set();
  const matchedDepositIds = new Set();

  const transferChecks = [];
  const warnings = [];

  const TRANSFER_WINDOW_DAYS = 5;

  for (const withdrawal of withdrawals) {
    const candidates = deposits
      .filter((deposit) => {
        if (matchedDepositIds.has(deposit._rowId)) {
          return false;
        }

        if (withdrawal._exchange === deposit._exchange) {
          return false;
        }

        if (withdrawal._asset !== deposit._asset) {
          return false;
        }

        if (
          !isFiniteNumber(withdrawal._amount) ||
          !isFiniteNumber(deposit._amount)
        ) {
          return false;
        }

        if (
          !amountsMatch(
            withdrawal._amount,
            deposit._amount
          )
        ) {
          return false;
        }

        const dayGap = getDaysBetweenSafe(
          withdrawal._date,
          deposit._date
        );

        return (
          dayGap >= 0 &&
          dayGap <= TRANSFER_WINDOW_DAYS
        );
      })
      .map((deposit) => ({
        deposit,
        ...scoreTransferCandidate(
          withdrawal,
          deposit
        ),
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      continue;
    }

    const best = candidates[0];
    const secondBest = candidates[1];

    const isAmbiguous =
      secondBest &&
      best.score === secondBest.score;

    if (isAmbiguous) {
      warnings.push({
        type: "AMBIGUOUS_TRANSFER_MATCH",
        message:
          `Withdrawal ${withdrawal._rowId} has multiple ` +
          `equally suitable deposit candidates.`,
        refId: withdrawal.refId ?? withdrawal._rowId,
        candidateRefs: candidates.map(
          (candidate) =>
            candidate.deposit.refId ??
            candidate.deposit._rowId
        ),
      });

      continue;
    }

    const deposit = best.deposit;

    matchedWithdrawalIds.add(withdrawal._rowId);
    matchedDepositIds.add(deposit._rowId);

    transferChecks.push({
      asset: withdrawal.asset ?? withdrawal._asset,
      amount: withdrawal._amount,

      from: withdrawal.exchange ?? withdrawal._exchange,
      to: deposit.exchange ?? deposit._exchange,

      fromRef: withdrawal.refId ?? withdrawal._rowId,
      toRef: deposit.refId ?? deposit._rowId,

      fromDate: withdrawal._date,
      toDate: deposit._date,

      status:
        best.score >= 80
          ? "MATCHED"
          : "PROBABLE_MATCH",

      confidence: best.score,
      reasons: best.reasons,

      requiresReview: best.score < 80,
    });
  }

  return {
    transferChecks,
    matchedWithdrawalIds,
    matchedDepositIds,
    warnings,
  };
}

// ---------------------------------------------------------
// Trade summary
// ---------------------------------------------------------

function buildTradeSummary(trades) {
  const summaryMap = new Map();

  for (const transaction of trades) {
    const key = [
      transaction._exchange,
      transaction._asset,
    ].join("__");

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        exchange: transaction.exchange,
        asset: transaction.asset,

        totalTraded: 0,
        totalInr: 0,

        tradeCount: 0,
        buyCount: 0,
        saleCount: 0,

        tdsApplicableCount: 0,
        tdsDeductedCount: 0,
        tdsMissingCount: 0,

        expectedTds: 0,
        reportedTds: 0,
        tdsDifference: 0,

        missingValueCount: 0,
        dataQualityIssueCount: 0,
      });
    }

    const summary = summaryMap.get(key);

    summary.tradeCount += 1;

    if (isFiniteNumber(transaction._amount)) {
      summary.totalTraded += transaction._amount;
    }

    if (isFiniteNumber(transaction._inrValue)) {
      summary.totalInr += transaction._inrValue;
    } else {
      summary.missingValueCount += 1;
    }

    if (hasDataQualityIssue(transaction)) {
      summary.dataQualityIssueCount += 1;
    }

    if (transaction._type === "BUY") {
      summary.buyCount += 1;
    }

    if (transaction._type === "SELL") {
      summary.saleCount += 1;
      summary.tdsApplicableCount += 1;

      const tdsStatus = upper(transaction.tdsStatus);

      if (tdsStatus === "DEDUCTED") {
        summary.tdsDeductedCount += 1;
      }

      if (
        transaction._tdsAmount === null &&
        tdsStatus === "UNKNOWN"
      ) {
        summary.tdsMissingCount += 1;
      }

      if (isFiniteNumber(transaction._inrValue)) {
        summary.expectedTds +=
          transaction._inrValue * 0.01;
      }

      if (isFiniteNumber(transaction._tdsAmount)) {
        summary.reportedTds += transaction._tdsAmount;
      }
    }
  }

  for (const summary of summaryMap.values()) {
    summary.tdsDifference =
      summary.expectedTds - summary.reportedTds;
  }

  return Array.from(summaryMap.values());
}

// ---------------------------------------------------------
// Sale-level TDS checks
// ---------------------------------------------------------

function buildTdsChecks(sales) {
  const tdsChecks = [];

  for (const sale of sales) {
    const expectedTds = isFiniteNumber(sale._inrValue)
      ? sale._inrValue * 0.01
      : null;

    const reportedTds = sale._tdsAmount;

    const status = upper(sale.tdsStatus);

    let tdsStatus = "UNKNOWN";
    let requiresReview = true;

    if (expectedTds === null) {
      tdsStatus = "MISSING_SALE_VALUE";
    } else if (status === "NOT_APPLICABLE") {
      tdsStatus = "MARKED_NOT_APPLICABLE";
    } else if (reportedTds === null) {
      tdsStatus = "MISSING_REPORTED_TDS";
    } else {
      const difference = expectedTds - reportedTds;

      if (Math.abs(difference) < 0.01) {
        tdsStatus = "MATCHED";
        requiresReview = false;
      } else {
        tdsStatus = "TDS_MISMATCH";
      }
    }

    tdsChecks.push({
      refId: sale.refId ?? sale._rowId,
      exchange: sale.exchange,
      asset: sale.asset,
      date: sale.date,

      saleValueInr: sale._inrValue,
      expectedTds,
      reportedTds,

      sourceTdsStatus: sale.tdsStatus ?? null,
      tdsStatus,
      requiresReview,
    });
  }

  return tdsChecks;
}

// ---------------------------------------------------------
// Data-quality warnings
// ---------------------------------------------------------

function buildDataQualityWarnings(rows) {
  const warnings = [];

  for (const row of rows) {
    for (const issue of row._dataQuality) {
      if (issue === "OK") {
        continue;
      }

      warnings.push({
        type: "DATA_QUALITY",
        issue,
        refId: row.refId ?? row._rowId,
        exchange: row.exchange,
        asset: row.asset,
        message:
          `Transaction ${row.refId ?? row._rowId} ` +
          `has data-quality issue: ${issue}.`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------
// Main reconciliation function
// ---------------------------------------------------------

export function reconcile(allRows, options = {}) {
  const rows = Array.isArray(allRows) ? allRows : [];

  const normalizedRows = rows.map(normalizeRow);

  const trades = normalizedRows.filter(
    (row) =>
      row._type === "BUY" ||
      row._type === "SELL"
  );

  const sales = normalizedRows.filter(
    (row) => row._type === "SELL"
  );

  const withdrawals = normalizedRows.filter(
    (row) => row._type === "WITHDRAWAL"
  );

  const deposits = normalizedRows.filter(
    (row) => row._type === "DEPOSIT"
  );

  const transferResult = matchTransfers(
    withdrawals,
    deposits
  );

  const unmatchedDeposits = deposits
    .filter(
      (deposit) =>
        !transferResult.matchedDepositIds.has(
          deposit._rowId
        )
    )
    .map((deposit) => ({
      type: "UNKNOWN_SOURCE",
      refId: deposit.refId ?? deposit._rowId,
      exchange: deposit.exchange,
      asset: deposit.asset,
      amount: deposit._amount,
      date: deposit._date,
      message:
        `${deposit._amount ?? "Unknown amount"} ` +
        `${deposit.asset || "unknown asset"} arrived on ` +
        `${deposit.exchange} with no matching withdrawal ` +
        `in the uploaded records.`,
      requiresReview: true,
    }));

  const orphanedWithdrawals = withdrawals
    .filter(
      (withdrawal) =>
        !transferResult.matchedWithdrawalIds.has(
          withdrawal._rowId
        )
    )
    .map((withdrawal) => ({
      type: "ORPHANED_WITHDRAWAL",
      refId: withdrawal.refId ?? withdrawal._rowId,
      exchange: withdrawal.exchange,
      asset: withdrawal.asset,
      amount: withdrawal._amount,
      date: withdrawal._date,
      message:
        `${withdrawal._amount ?? "Unknown amount"} ` +
        `${withdrawal.asset || "unknown asset"} withdrawn from ` +
        `${withdrawal.exchange} has no matching deposit ` +
        `in the uploaded records.`,
      requiresReview: true,
    }));

  const valuationWarnings = trades
    .filter(
      (trade) =>
        trade.consideration?.valuationStatus ===
        "MISMATCH"
    )
    .map((trade) => ({
      type: "VALUATION_MISMATCH",
      refId: trade.refId ?? trade._rowId,
      exchange: trade.exchange,
      asset: trade.asset,
      message:
        `Transaction ${trade.refId ?? trade._rowId} ` +
        `has a valuation mismatch.`,
      reportedValue:
        trade.consideration?.reportedInrValue ?? null,
      determinedValue:
        trade.consideration?.inrValue ?? null,
      requiresReview: true,
    }));

  const warnings = [
    ...transferResult.warnings,
    ...orphanedWithdrawals,
    ...valuationWarnings,
    ...buildDataQualityWarnings(normalizedRows),
  ];

  const tradeSummary = buildTradeSummary(trades);
  const tdsChecks = buildTdsChecks(sales);

  const expectedTds = tdsChecks.reduce(
    (total, check) =>
      total +
      (isFiniteNumber(check.expectedTds)
        ? check.expectedTds
        : 0),
    0
  );

  const reportedTds = tdsChecks.reduce(
    (total, check) =>
      total +
      (isFiniteNumber(check.reportedTds)
        ? check.reportedTds
        : 0),
    0
  );

  const tdsDiscrepancies = tdsChecks.filter(
    (check) => check.requiresReview
  );

  const totalInrValue = trades.reduce(
    (total, trade) =>
      total +
      (isFiniteNumber(trade._inrValue)
        ? trade._inrValue
        : 0),
    0
  );

  const sellVolumeInr = sales.reduce(
    (total, sale) =>
      total +
      (isFiniteNumber(sale._inrValue)
        ? sale._inrValue
        : 0),
    0
  );

  const result = {
    tradeSummary,

    transferChecks: transferResult.transferChecks,

    unmatchedDeposits,

    orphanedWithdrawals,

    warnings,

    tdsChecks,

    tdsDiscrepancies,

    summary: {
      transactionCount: normalizedRows.length,
      tradeCount: trades.length,
      buyCount: normalizedRows.filter(
        (row) => row._type === "BUY"
      ).length,
      saleCount: sales.length,

      withdrawalCount: withdrawals.length,
      depositCount: deposits.length,

      matchedTransferCount:
        transferResult.transferChecks.filter(
          (transfer) =>
            transfer.status === "MATCHED"
        ).length,

      probableTransferCount:
        transferResult.transferChecks.filter(
          (transfer) =>
            transfer.status === "PROBABLE_MATCH"
        ).length,

      unmatchedDepositCount:
        unmatchedDeposits.length,

      orphanedWithdrawalCount:
        orphanedWithdrawals.length,

      totalInrValue,
      sellVolumeInr,

      expectedTds,
      reportedTds,
      tdsDifference: expectedTds - reportedTds,

      tdsDiscrepancyCount:
        tdsDiscrepancies.length,

      warningCount: warnings.length,

      requiresReview:
        warnings.length > 0 ||
        tdsDiscrepancies.length > 0,
    },

    metadata: {
      engineVersion: "generic-v2",
      accountingMethod:
        options.accountingMethod ?? "FIFO_PENDING",
      tdsRate:
        options.tdsRate ?? 0.01,
      transferWindowDays:
        options.transferWindowDays ?? 5,
    },
  };

  return result;
}