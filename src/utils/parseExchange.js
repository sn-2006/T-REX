import Papa from "papaparse";
import { withDeterminedConsideration } from "./consideration.js";

/*
 * Generic exchange CSV parser.
 *
 * Goals:
 * - Support different exchange column names.
 * - Never silently convert missing numbers into 0.
 * - Normalize transaction types.
 * - Normalize assets and currencies.
 * - Preserve original CSV data.
 * - Keep unknown or invalid data visible for review.
 * - Remain independent of any particular exchange or CSV file.
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

function compactKey(value) {
  return upper(value)
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      clean(row[key]) !== ""
    ) {
      return row[key];
    }
  }

  return null;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value)
    .trim()
    .replace(/,/g, "")
    .replace(/[₹$€£]/g, "")
    .replace(/\s/g, "");

  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = upper(value);

  if (["TRUE", "YES", "Y", "1"].includes(normalized)) {
    return true;
  }

  if (["FALSE", "NO", "N", "0"].includes(normalized)) {
    return false;
  }

  return null;
}

// ---------------------------------------------------------
// Column alias support
// ---------------------------------------------------------

const COLUMN_ALIASES = {
  date: [
    "date",
    "datetime",
    "date_time",
    "timestamp",
    "time",
    "transaction_date",
    "transaction_time",
    "created_at",
    "executed_at",
  ],

  type: [
    "type",
    "transaction_type",
    "transactiontype",
    "side",
    "action",
    "operation",
    "order_type",
    "trade_type",
  ],

  asset: [
    "asset",
    "coin",
    "symbol",
    "currency",
    "crypto",
    "crypto_asset",
    "base_asset",
    "base_currency",
    "token",
  ],

  amount: [
    "amount",
    "quantity",
    "qty",
    "volume",
    "asset_amount",
    "asset_quantity",
    "executed_amount",
    "executed_quantity",
    "base_amount",
    "base_quantity",
  ],

  price: [
    "price",
    "unit_price",
    "unitprice",
    "rate",
    "execution_price",
    "executed_price",
    "average_price",
    "avg_price",
  ],

  inrValue: [
    "inr_value",
    "inrvalue",
    "value_inr",
    "amount_inr",
    "total_inr",
    "gross_inr",
    "net_inr",
    "consideration",
    "consideration_inr",
    "total_value",
    "trade_value",
  ],

  quoteCurrency: [
    "quote_currency",
    "quote_currency_code",
    "quote_asset",
    "quoteasset",
    "price_currency",
    "pricecurrency",
    "settlement_currency",
    "fiat_currency",
  ],

  quoteAmount: [
    "quote_amount",
    "quoteamount",
    "quote_quantity",
    "quotequantity",
    "counter_amount",
    "counter_value",
  ],

  assetType: [
    "asset_type",
    "asset_category",
    "assettype",
    "category",
    "instrument_type",
  ],

  source: [
    "source",
    "source_address",
    "from",
    "from_address",
    "sender",
    "sender_address",
    "origin",
  ],

  destination: [
    "destination",
    "destination_address",
    "to",
    "to_address",
    "receiver",
    "receiver_address",
    "recipient",
  ],

  sourceOwner: [
    "source_owner",
    "sourceowner",
    "from_owner",
    "fromowner",
    "sender_owner",
  ],

  destinationOwner: [
    "destination_owner",
    "destinationowner",
    "to_owner",
    "toowner",
    "receiver_owner",
  ],

  ownershipChanged: [
    "ownership_changed",
    "ownershipchanged",
    "ownership_transfer",
    "is_ownership_changed",
  ],

  counterparty: [
    "counterparty",
    "counter_party",
    "merchant",
    "recipient_name",
    "sender_name",
  ],

  fxRateInr: [
    "fx_rate_inr",
    "fxrateinr",
    "inr_per_unit",
    "inr_per_quote_unit",
    "exchange_rate_inr",
    "conversion_rate",
  ],

  receivedAsset: [
    "received_asset",
    "receivedasset",
    "target_asset",
    "quote_asset_received",
    "output_asset",
  ],

  receivedAssetType: [
    "received_asset_type",
    "receivedassettype",
    "target_asset_type",
    "output_asset_type",
  ],

  receivedAmount: [
    "received_amount",
    "receivedamount",
    "received_quantity",
    "receivedquantity",
    "output_amount",
    "output_quantity",
    "target_amount",
  ],

  receivedAssetFmvInrPerUnit: [
    "received_asset_fmv_inr_per_unit",
    "receivedassetfmvinrperunit",
    "received_fmv_inr_per_unit",
    "received_unit_price_inr",
    "target_asset_fmv_inr",
  ],

  tdsStatus: [
    "tds_status",
    "tdsstatus",
    "tds_state",
    "tax_status",
    "withholding_status",
  ],

  tdsAmount: [
    "tds_amount",
    "tdsamount",
    "tds_deducted",
    "tax_deducted",
    "withholding_amount",
    "tds_value",
  ],

  fee: [
    "fee",
    "fees",
    "transaction_fee",
    "trading_fee",
    "network_fee",
    "commission",
  ],

  feeAsset: [
    "fee_asset",
    "feeasset",
    "fee_currency",
    "fee_coin",
  ],

  transactionHash: [
    "transaction_hash",
    "tx_hash",
    "txhash",
    "hash",
    "blockchain_hash",
  ],

  walletAddress: [
    "wallet_address",
    "wallet",
    "address",
    "user_wallet",
  ],

  refId: [
    "ref_id",
    "refid",
    "reference_id",
    "transaction_id",
    "transactionid",
    "trade_id",
    "tradeid",
    "order_id",
    "orderid",
    "id",
  ],
};

// ---------------------------------------------------------
// Header normalization
// ---------------------------------------------------------

function buildNormalizedHeaderMap(row) {
  const map = {};

  for (const originalKey of Object.keys(row || {})) {
    map[compactKey(originalKey)] = originalKey;
  }

  return map;
}

function getAliasedValue(row, aliases, headerMap) {
  for (const alias of aliases) {
    const normalizedAlias = compactKey(alias);
    const originalKey = headerMap[normalizedAlias];

    if (!originalKey) {
      continue;
    }

    const value = row[originalKey];

    if (
      value !== undefined &&
      value !== null &&
      clean(value) !== ""
    ) {
      return value;
    }
  }

  return null;
}

// ---------------------------------------------------------
// Transaction type normalization
// ---------------------------------------------------------

export function normalizeTransactionType(value) {
  const type = compactKey(value);

  if (!type) {
    return "UNKNOWN";
  }

  if (
    [
      "BUY",
      "PURCHASE",
      "PURCHASEORDER",
      "BUYORDER",
      "BOUGHT",
      "ACQUIRE",
      "ACQUISITION",
    ].includes(type)
  ) {
    return "BUY";
  }

  if (
    [
      "SELL",
      "SALE",
      "SELLORDER",
      "SOLD",
      "DISPOSE",
      "DISPOSAL",
    ].includes(type)
  ) {
    return "SELL";
  }

  if (
    [
      "WITHDRAWAL",
      "WITHDRAW",
      "WITHDRAWALCOMPLETED",
      "SEND",
      "SENT",
      "TRANSFEROUT",
      "OUT",
      "CRYPTOOUT",
    ].includes(type)
  ) {
    return "WITHDRAWAL";
  }

  if (
    [
      "DEPOSIT",
      "DEPOSITCOMPLETED",
      "RECEIVE",
      "RECEIVED",
      "TRANSFERIN",
      "IN",
      "CRYPTOIN",
    ].includes(type)
  ) {
    return "DEPOSIT";
  }

  if (
    [
      "TRANSFER",
      "INTERNALTRANSFER",
      "WALLETTRANSFER",
      "MOVE",
      "MOVEMENT",
    ].includes(type)
  ) {
    return "TRANSFER";
  }

  if (
    [
      "SWAP",
      "CONVERT",
      "CONVERSION",
      "EXCHANGE",
      "TRADE",
    ].includes(type)
  ) {
    return type === "TRADE" ? "TRADE" : "SWAP";
  }

  if (
    [
      "FEE",
      "FEES",
      "COMMISSION",
      "NETWORKFEE",
      "TRADINGFEE",
    ].includes(type)
  ) {
    return "FEE";
  }

  if (
    [
      "AIRDROP",
      "REWARD",
      "STAKINGREWARD",
      "INTEREST",
      "BONUS",
      "CASHBACK",
    ].includes(type)
  ) {
    return "INCOME";
  }

  return type;
}

// ---------------------------------------------------------
// Date normalization
// ---------------------------------------------------------

function normalizeDate(value) {
  if (value === undefined || value === null || clean(value) === "") {
    return {
      raw: null,
      value: null,
      valid: false,
    };
  }

  const raw = value;

  let date;

  if (typeof value === "number") {
    // Support seconds and milliseconds Unix timestamps.
    const milliseconds =
      value < 100000000000 ? value * 1000 : value;

    date = new Date(milliseconds);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return {
      raw,
      value: null,
      valid: false,
    };
  }

  return {
    raw,
    value: date.toISOString(),
    valid: true,
  };
}

// ---------------------------------------------------------
// Stable transaction ID
// ---------------------------------------------------------

function createFallbackRefId({
  exchange,
  date,
  type,
  asset,
  amount,
  price,
  index,
}) {
  return [
    clean(exchange) || "UNKNOWN_EXCHANGE",
    date || "NO_DATE",
    type || "UNKNOWN",
    asset || "UNKNOWN_ASSET",
    amount ?? "NO_AMOUNT",
    price ?? "NO_PRICE",
    index,
  ].join("__");
}

// ---------------------------------------------------------
// Row normalization
// ---------------------------------------------------------

function normalizeRow(row, exchangeName, index) {
  const headerMap = buildNormalizedHeaderMap(row);

  const rawDate = getAliasedValue(
    row,
    COLUMN_ALIASES.date,
    headerMap
  );

  const dateInfo = normalizeDate(rawDate);

  const rawType = getAliasedValue(
    row,
    COLUMN_ALIASES.type,
    headerMap
  );

  const rawAsset = getAliasedValue(
    row,
    COLUMN_ALIASES.asset,
    headerMap
  );

  const rawAmount = getAliasedValue(
    row,
    COLUMN_ALIASES.amount,
    headerMap
  );

  const rawPrice = getAliasedValue(
    row,
    COLUMN_ALIASES.price,
    headerMap
  );

  const rawInrValue = getAliasedValue(
    row,
    COLUMN_ALIASES.inrValue,
    headerMap
  );

  const rawRefId = getAliasedValue(
    row,
    COLUMN_ALIASES.refId,
    headerMap
  );

  const type = normalizeTransactionType(rawType);
  const asset = upper(rawAsset);
  const amount = parseNumber(rawAmount);
  const price = parseNumber(rawPrice);
  const inrValue = parseNumber(rawInrValue);

  const refId =
    clean(rawRefId) ||
    createFallbackRefId({
      exchange: exchangeName,
      date: dateInfo.value || clean(rawDate),
      type,
      asset,
      amount,
      price,
      index,
    });

  const normalized = {
    // Preserve the original CSV row for audit/debugging.
    originalRow: { ...row },

    exchange: clean(exchangeName) || "UNKNOWN_EXCHANGE",

    date: dateInfo.value,
    rawDate: dateInfo.raw,
    dateValid: dateInfo.valid,

    type,
    rawType: clean(rawType) || null,

    asset,
    rawAsset: clean(rawAsset) || null,

    assetType:
      getAliasedValue(
        row,
        COLUMN_ALIASES.assetType,
        headerMap
      ) || null,

    amount,
    price,

    quoteCurrency:
      upper(
        getAliasedValue(
          row,
          COLUMN_ALIASES.quoteCurrency,
          headerMap
        )
      ) || "INR",

    quoteAmount: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.quoteAmount,
        headerMap
      )
    ),

    inrValue,

    source:
      getAliasedValue(
        row,
        COLUMN_ALIASES.source,
        headerMap
      ) || null,

    destination:
      getAliasedValue(
        row,
        COLUMN_ALIASES.destination,
        headerMap
      ) || null,

    sourceOwner:
      getAliasedValue(
        row,
        COLUMN_ALIASES.sourceOwner,
        headerMap
      ) || null,

    destinationOwner:
      getAliasedValue(
        row,
        COLUMN_ALIASES.destinationOwner,
        headerMap
      ) || null,

    ownershipChanged: parseBoolean(
      getAliasedValue(
        row,
        COLUMN_ALIASES.ownershipChanged,
        headerMap
      )
    ),

    counterparty:
      getAliasedValue(
        row,
        COLUMN_ALIASES.counterparty,
        headerMap
      ) || null,

    fxRateInr: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.fxRateInr,
        headerMap
      )
    ),

    receivedAsset:
      upper(
        getAliasedValue(
          row,
          COLUMN_ALIASES.receivedAsset,
          headerMap
        )
      ) || null,

    receivedAssetType:
      getAliasedValue(
        row,
        COLUMN_ALIASES.receivedAssetType,
        headerMap
      ) || null,

    receivedAmount: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.receivedAmount,
        headerMap
      )
    ),

    receivedAssetFmvInrPerUnit: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.receivedAssetFmvInrPerUnit,
        headerMap
      )
    ),

    tdsStatus:
      upper(
        getAliasedValue(
          row,
          COLUMN_ALIASES.tdsStatus,
          headerMap
        )
      ) || "UNKNOWN",

    tdsAmount: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.tdsAmount,
        headerMap
      )
    ),

    fee: parseNumber(
      getAliasedValue(
        row,
        COLUMN_ALIASES.fee,
        headerMap
      )
    ),

    feeAsset:
      upper(
        getAliasedValue(
          row,
          COLUMN_ALIASES.feeAsset,
          headerMap
        )
      ) || null,

    transactionHash:
      getAliasedValue(
        row,
        COLUMN_ALIASES.transactionHash,
        headerMap
      ) || null,

    walletAddress:
      getAliasedValue(
        row,
        COLUMN_ALIASES.walletAddress,
        headerMap
      ) || null,

    refId,

    // Useful audit metadata.
    sourceRowNumber: index + 2,
    dataQuality: [],
  };

  // -------------------------------------------------------
  // Data-quality checks
  // -------------------------------------------------------

  if (!normalized.dateValid) {
    normalized.dataQuality.push("INVALID_OR_MISSING_DATE");
  }

  if (!normalized.asset) {
    normalized.dataQuality.push("MISSING_ASSET");
  }

  if (normalized.amount === null) {
    normalized.dataQuality.push("MISSING_OR_INVALID_AMOUNT");
  }

  if (normalized.type === "UNKNOWN") {
    normalized.dataQuality.push("UNKNOWN_TRANSACTION_TYPE");
  }

  if (
    normalized.type === "SELL" &&
    normalized.inrValue === null &&
    (normalized.price === null || normalized.amount === null)
  ) {
    normalized.dataQuality.push("MISSING_SELL_VALUATION");
  }

  if (
    normalized.type === "SELL" &&
    normalized.tdsAmount === null &&
    normalized.tdsStatus === "UNKNOWN"
  ) {
    normalized.dataQuality.push("MISSING_TDS_INFORMATION");
  }

  if (normalized.dataQuality.length === 0) {
    normalized.dataQuality.push("OK");
  }

  return normalized;
}

// ---------------------------------------------------------
// Public CSV parser
// ---------------------------------------------------------

export function parseExchangeCSV(fileText, exchangeName) {
  if (typeof fileText !== "string") {
    throw new TypeError("CSV input must be a string.");
  }

  const text = fileText.replace(/^\uFEFF/, "").trim();

  if (!text) {
    return [];
  }

  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (header) => clean(header),
  });

  if (result.errors?.length > 0) {
    console.warn("CSV parse warnings:", result.errors);
  }

  const rows = Array.isArray(result.data)
    ? result.data
    : [];

  return rows
    .filter((row) => row && Object.keys(row).length > 0)
    .map((row, index) => {
      const normalized = normalizeRow(
        row,
        exchangeName,
        index
      );

      return withDeterminedConsideration(normalized);
    });
}

// ---------------------------------------------------------
// Date utility used by reconciliation
// ---------------------------------------------------------

export function daysBetween(d1, d2) {
  if (!d1 || !d2) {
    return Infinity;
  }

  const a = new Date(d1);
  const b = new Date(d2);

  if (
    Number.isNaN(a.getTime()) ||
    Number.isNaN(b.getTime())
  ) {
    return Infinity;
  }

  return Math.abs(
    (a.getTime() - b.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}