const STABLECOINS = new Set(["USDC", "USDT", "DAI", "USDS", "USDE"]);
const STABLECOIN_INR_SYMBOLS = new Set(["INR", "INRT", "XIDR", "INR1"]);
const COINGECKO_IDS = {
  ADA: "cardano",
  AVAX: "avalanche-2",
  BNB: "binancecoin",
  BTC: "bitcoin",
  DAI: "dai",
  DOGE: "dogecoin",
  ETH: "ethereum",
  LINK: "chainlink",
  LTC: "litecoin",
  MATIC: "matic-network",
  POL: "matic-network",
  SHIB: "shiba-inu",
  SOL: "solana",
  TRX: "tron",
  UNI: "uniswap",
  USDC: "usd-coin",
  USDT: "tether",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  XRP: "ripple",
};

const valuationCache = new Map();

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAsset(value) {
  return String(value || "").trim().toUpperCase();
}

function dateParts(date) {
  const timestamp = date ? new Date(date) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
  return {
    iso: timestamp.toISOString(),
    day: timestamp.toISOString().slice(0, 10),
    providerDate: `${timestamp.toISOString().slice(8, 10)}-${timestamp.toISOString().slice(5, 7)}-${timestamp.toISOString().slice(0, 4)}`,
  };
}

async function fetchCoinGeckoHistory(asset, tokenAddress, date, parts) {
  const normalizedAsset = normalizeAsset(asset);
  const id = COINGECKO_IDS[normalizedAsset];
  const endpoint = tokenAddress
    ? `https://api.coingecko.com/api/v3/coins/ethereum/contract/${tokenAddress}/history?date=${parts.providerDate}`
    : id
      ? `https://api.coingecko.com/api/v3/coins/${id}/history?date=${parts.providerDate}`
      : null;
  if (!endpoint) return null;

  const cacheKey = `${endpoint}`;
  if (valuationCache.has(cacheKey)) return valuationCache.get(cacheKey);
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) {
      valuationCache.set(cacheKey, null);
      return null;
    }
    const payload = await response.json();
    const price = finiteNumber(payload?.market_data?.current_price?.usd);
    const result = price == null
      ? null
      : {
          provider: "CoinGecko",
          timestamp: payload?.market_data?.current_price?.last_updated || parts.iso,
          price,
          currency: "USD",
          method: tokenAddress ? "ethereum_contract_historical_price" : "asset_historical_price",
          provenance: tokenAddress ? "token contract address" : "asset symbol mapping",
        };
    valuationCache.set(cacheKey, result);
    return result;
  } catch {
    valuationCache.set(cacheKey, null);
    return null;
  }
}

export function isStablecoinAsset(asset) {
  return STABLECOINS.has(normalizeAsset(asset));
}

export function isInrPeggedAsset(asset) {
  return STABLECOIN_INR_SYMBOLS.has(normalizeAsset(asset));
}

export async function resolveHistoricalInrValuation({
  asset,
  tokenAddress = null,
  amount,
  date,
  fxRateInr,
  fxProvider = "Frankfurter",
  actualInrReceived = null,
  actualInrEvidence = null,
}) {
  const normalizedAsset = normalizeAsset(asset);
  const quantity = finiteNumber(amount);
  const parts = dateParts(date);
  const fxRate = finiteNumber(fxRateInr);
  const evidenceBase = {
    provider: null,
    timestamp: parts?.iso || null,
    price: null,
    currency: "INR",
    method: null,
    provenance: "on-chain swap evidence; no fiat settlement evidence",
  };

  const verifiedActualInr = finiteNumber(actualInrReceived);
  if (
    verifiedActualInr != null &&
    actualInrEvidence &&
    ["exchange_settlement", "bank_settlement", "fiat_rail"].includes(actualInrEvidence.type)
  ) {
    return {
      actualInrReceived: verifiedActualInr,
      estimatedInrValue: null,
      valuationStatus: "VERIFIED_INR",
      valuationEvidence: {
        ...evidenceBase,
        provider: actualInrEvidence.provider || "settlement evidence",
        timestamp: actualInrEvidence.timestamp || parts?.iso || null,
        price: verifiedActualInr,
        priceCurrency: "INR",
        currency: "INR",
        method: actualInrEvidence.type,
        provenance: "exchange/bank/fiat settlement evidence",
      },
    };
  }

  if (quantity == null || quantity < 0 || !parts) {
    return {
      actualInrReceived: null,
      estimatedInrValue: null,
      valuationStatus: "UNAVAILABLE",
      valuationEvidence: { ...evidenceBase, method: "missing_amount_or_timestamp" },
    };
  }

  if (isInrPeggedAsset(normalizedAsset)) {
    return {
      actualInrReceived: null,
      estimatedInrValue: null,
      valuationStatus: "PENDING_VALUATION",
      valuationEvidence: {
        ...evidenceBase,
        method: "inr_pegged_asset_requires_settlement_evidence",
        provenance: "asset naming alone does not prove INR settlement",
      },
    };
  }

  let usdPrice;
  let priceEvidence;
  if (isStablecoinAsset(normalizedAsset)) {
    usdPrice = 1;
    priceEvidence = {
      provider: "stablecoin classification",
      timestamp: parts.iso,
      price: 1,
      currency: "USD",
      method: "stablecoin_usd_peg_fair_value",
      provenance: "stablecoin classification; not INR settlement evidence",
    };
  } else {
    priceEvidence = await fetchCoinGeckoHistory(normalizedAsset, tokenAddress, date, parts);
    usdPrice = priceEvidence?.price ?? null;
  }

  if (usdPrice == null || fxRate == null) {
    return {
      actualInrReceived: null,
      estimatedInrValue: null,
      valuationStatus: "PENDING_VALUATION",
      valuationEvidence: {
        ...evidenceBase,
        ...(priceEvidence || {}),
        fxRateInr: fxRate,
        fxProvider,
        priceCurrency: priceEvidence?.currency || "USD",
        method: priceEvidence ? "historical_asset_price_missing_or_fx_missing" : "historical_asset_price_unavailable",
      },
    };
  }

  const estimatedInrValue = Math.round(quantity * usdPrice * fxRate * 100) / 100;
  return {
    actualInrReceived: null,
    estimatedInrValue,
    valuationStatus: "ESTIMATED_INR",
    valuationEvidence: {
      ...priceEvidence,
      timestamp: priceEvidence.timestamp || parts.iso,
      priceCurrency: priceEvidence.currency || "USD",
      currency: "INR",
      price: usdPrice,
      fxRateInr: fxRate,
      fxProvider,
      method: `${priceEvidence.method}_times_historical_usd_inr`,
      provenance: `${priceEvidence.provenance}; historical USD/INR FX; no fiat settlement evidence`,
    },
  };
}
