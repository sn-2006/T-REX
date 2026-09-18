import crypto from "crypto";

const BASE = "https://api.binance.com";

async function signedGet(path, params, apiKey, apiSecret) {
  const queryString = new URLSearchParams({
    ...params,
    timestamp: Date.now(),
    recvWindow: 10000,
  }).toString();

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  const response = await fetch(
    `${BASE}${path}?${queryString}&signature=${signature}`,
    {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.msg || `Binance error ${response.status}`
    );

    error.status = response.status;
    error.binanceResponse = data;

    throw error;
  }

  return data;
}

async function getSymbols(apiKey, apiSecret) {
  const account = await signedGet(
    "/api/v3/account",
    {},
    apiKey,
    apiSecret
  );

  const assets = account.balances
    .filter(
      (balance) =>
        Number(balance.free) + Number(balance.locked) > 0
    )
    .map((balance) => balance.asset);

  const quotes = ["USDT", "BTC", "FDUSD"];

  const symbols = [
    ...new Set(
      assets.flatMap((asset) =>
        quotes
          .filter((quote) => quote !== asset)
          .map((quote) => `${asset}${quote}`)
      )
    ),
  ];

  return symbols;
}

async function getTradesForSymbol(
  symbol,
  from,
  to,
  apiKey,
  apiSecret
) {
  const trades = [];
  let startTime = from;

  while (true) {
    const batch = await signedGet(
      "/api/v3/myTrades",
      {
        symbol,
        startTime,
        limit: 1000,
      },
      apiKey,
      apiSecret
    );

    trades.push(...batch);

    if (batch.length < 1000) {
      break;
    }

    startTime = batch[batch.length - 1].time + 1;

    if (startTime > to) {
      break;
    }
  }

  return trades.filter(
    (trade) => trade.time >= from && trade.time <= to
  );
}

export async function fetchBinanceTrades({
  apiKey,
  apiSecret,
  from,
  to,
}) {
  const symbols = await getSymbols(
    apiKey,
    apiSecret
  );

  const allTrades = [];

  for (const symbol of symbols) {
    try {
      const trades = await getTradesForSymbol(
        symbol,
        from,
        to,
        apiKey,
        apiSecret
      );

      allTrades.push(...trades);
    } catch (error) {
      // Ignore symbols that don't exist on Binance.
      if (!/Invalid symbol/i.test(error.message)) {
        throw error;
      }
    }
  }

  // Remove accidental duplicates.
  const uniqueTrades = [
    ...new Map(
      allTrades.map((trade) => [
        `${trade.symbol}-${trade.id}`,
        trade,
      ])
    ).values(),
  ];

  return uniqueTrades.sort(
    (a, b) => a.time - b.time
  );
}