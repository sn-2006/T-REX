// ---------------------------------------------------------------------------
// Deterministic VDA transaction classification.
//
// This layer answers a different question from consideration.js:
//   1) Is the transaction a VDA transfer?
//   2) What kind of transfer/movement is it?
//   3) How confident is the classification from the supplied transaction data?
//
// It deliberately does NOT decide the tax amount. The 194S rule engine consumes
// this classification and the consideration determined by consideration.js.
//
// Important prototype rule:
// - BUY / SELL / SWAP / CONVERT / TRADE are treated as ownership-transfer
//   events when the asset is identified as a VDA.
// - DEPOSIT / WITHDRAWAL / TRANSFER are wallet/exchange movements. They are
//   only classified as an ownership transfer when explicit ownership data says
//   the source and destination owners differ.
// - Without ownership information, movement rows are UNDETERMINED rather than
//   guessed. This prevents an internal wallet movement from being treated as a
//   taxable transfer merely because a VDA moved.
// ---------------------------------------------------------------------------

const KNOWN_VDA_ASSETS = new Set([
  "BTC", "ETH", "USDT", "USDC", "MATIC", "POL", "SOL", "BNB", "XRP",
  "ADA", "DOGE", "DOT", "AVAX", "LINK", "LTC", "SHIB", "UNI", "ATOM",
  "TRX", "DAI", "WBTC", "WETH",
]);

const TRADE_TYPES = new Set(["BUY", "SELL", "SWAP", "CONVERT", "TRADE", "EXCHANGE"]);
const MOVEMENT_TYPES = new Set(["TRANSFER", "DEPOSIT", "WITHDRAWAL", "SEND", "RECEIVE"]);

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && clean(row[key]) !== "") return row[key];
  }
  return null;
}

function assetLooksLikeVda(asset, explicitType) {
  const normalized = upper(asset);
  const declaredType = upper(explicitType);
  if (["VDA", "CRYPTO", "CRYPTOCURRENCY", "TOKEN"].includes(declaredType)) return true;
  if (["FIAT", "INR", "USD", "EUR", "USDT_FIAT"].includes(declaredType)) return false;
  if (!normalized) return null;
  return KNOWN_VDA_ASSETS.has(normalized);
}

function normalizeOwnership(value) {
  const v = upper(value);
  if (!v) return null;
  if (["SELF", "OWN", "OWNED_BY_USER", "USER", "MYSELF"].includes(v)) return "SELF";
  if (["OTHER", "COUNTERPARTY", "THIRD_PARTY", "EXTERNAL", "SELLER", "BUYER"].includes(v)) return "OTHER";
  return v;
}

function classifyMovementOwnership(row) {
  const sourceOwner = normalizeOwnership(
    firstValue(row, ["sourceOwner", "source_owner", "fromOwner", "from_owner"])
  );
  const destinationOwner = normalizeOwnership(
    firstValue(row, ["destinationOwner", "destination_owner", "toOwner", "to_owner"])
  );

  if (sourceOwner && destinationOwner) {
    return { sourceOwner, destinationOwner, known: true, changed: sourceOwner !== destinationOwner };
  }

  const ownershipChanged = firstValue(row, ["ownershipChanged", "ownership_changed"]);
  if (ownershipChanged !== null) {
    const value = upper(ownershipChanged);
    if (["TRUE", "YES", "1"].includes(value)) {
      return { sourceOwner, destinationOwner, known: true, changed: true };
    }
    if (["FALSE", "NO", "0"].includes(value)) {
      return { sourceOwner, destinationOwner, known: true, changed: false };
    }
  }

  return { sourceOwner, destinationOwner, known: false, changed: null };
}

export function classifyTransaction(row) {
  const type = upper(row.type);
  const asset = upper(row.asset);
  const receivedAsset = upper(row.receivedAsset || row.received_asset);
  const assetIsVda = assetLooksLikeVda(asset, row.assetType || row.asset_type);
  const receivedAssetIsVda = assetLooksLikeVda(
    receivedAsset,
    row.receivedAssetType || row.received_asset_type
  );

  // A known VDA on a trade row is a transfer event. The specific direction is
  // inferred from the economic fields that the consideration engine also uses.
  if (TRADE_TYPES.has(type)) {
    if (assetIsVda === false) {
      return {
        status: "NOT_VDA",
        isVdaTransfer: false,
        transferType: "NON_VDA_TRADE",
        confidence: 100,
        reason: `${asset || "Unknown asset"} is not in the configured VDA asset registry`,
      };
    }

    if (assetIsVda === true) {
      if (type === "SELL") {
        if (receivedAssetIsVda) {
          return {
            status: "CONFIRMED",
            isVdaTransfer: true,
            transferType: "VDA_TO_VDA",
            confidence: 100,
            reason: "SELL row with a VDA asset and received VDA",
          };
        }
        const quoteCurrency = upper(
          row.quoteCurrency || row.quote_currency || row.quoteAsset || row.quote_asset || row.priceCurrency
        );
        return {
          status: "CONFIRMED",
          isVdaTransfer: true,
          transferType: quoteCurrency && quoteCurrency !== "INR" ? "VDA_TO_FOREIGN_CURRENCY" : "VDA_TO_INR",
          confidence: 100,
          reason: "SELL row with a VDA asset and a consideration currency",
        };
      }

      if (type === "BUY") {
        return {
          status: "CONFIRMED",
          isVdaTransfer: true,
          transferType: receivedAssetIsVda ? "VDA_PURCHASE_VDA_CONSIDERATION" : "VDA_PURCHASE",
          confidence: 100,
          reason: "BUY row represents acquisition of a VDA",
        };
      }

      if (receivedAssetIsVda) {
        return {
          status: "CONFIRMED",
          isVdaTransfer: true,
          transferType: "VDA_TO_VDA",
          confidence: 100,
          reason: `${type} row contains VDA-to-VDA exchange information`,
        };
      }

      return {
        status: "CONFIRMED",
        isVdaTransfer: true,
        transferType: "VDA_TRADE",
        confidence: 90,
        reason: `${type} row contains a known VDA asset`,
      };
    }

    return {
      status: "UNDETERMINED",
      isVdaTransfer: null,
      transferType: "UNKNOWN_ASSET_TRADE",
      confidence: 0,
      reason: "Asset is missing or is not in the configured VDA registry",
    };
  }

  // Wallet/exchange movements are not automatically taxable ownership
  // transfers. We need explicit ownership evidence to distinguish a user's
  // own wallet movement from a transfer to another person.
  if (MOVEMENT_TYPES.has(type)) {
    const ownership = classifyMovementOwnership(row);
    if (assetIsVda === false) {
      return {
        status: "NOT_VDA",
        isVdaTransfer: false,
        transferType: "NON_VDA_MOVEMENT",
        confidence: 100,
        reason: `${asset || "Unknown asset"} is not in the configured VDA asset registry`,
        ...ownership,
      };
    }

    if (assetIsVda === true && ownership.known) {
      return {
        status: ownership.changed ? "CONFIRMED" : "NOT_TRANSFER",
        isVdaTransfer: ownership.changed,
        transferType: ownership.changed ? "VDA_OWNERSHIP_TRANSFER" : "OWN_VDA_MOVEMENT",
        confidence: 100,
        reason: ownership.changed
          ? "Source and destination ownership are explicitly different"
          : "Source and destination are explicitly under the same ownership",
        ...ownership,
      };
    }

    if (assetIsVda === true) {
      return {
        status: "UNDETERMINED",
        isVdaTransfer: null,
        transferType: "VDA_MOVEMENT_OWNERSHIP_UNKNOWN",
        confidence: 0,
        reason: "VDA moved, but source/destination ownership is not supplied",
        ...ownership,
      };
    }
  }

  return {
    status: "UNDETERMINED",
    isVdaTransfer: null,
    transferType: "UNCLASSIFIED",
    confidence: 0,
    reason: "Transaction type does not contain enough information for classification",
  };
}

export function withTransactionClassification(row) {
  return {
    ...row,
    transactionClassification: classifyTransaction(row),
  };
}

export { KNOWN_VDA_ASSETS };
