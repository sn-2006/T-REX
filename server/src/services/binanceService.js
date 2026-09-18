import crypto from "crypto";

const BASE_URL =
  process.env.BINANCE_API_BASE_URL || "https://api.binance.com";

export async function binanceRequest(path, params = {}) {
  const timestamp = Date.now();

  const queryParams = new URLSearchParams({
    ...params,
    timestamp: String(timestamp),
  });

  const signature = crypto
    .createHmac("sha256", process.env.BINANCE_API_SECRET)
    .update(queryParams.toString())
    .digest("hex");

  queryParams.set("signature", signature);

  const response = await fetch(
    `${BASE_URL}${path}?${queryParams.toString()}`,
    {
      headers: {
        "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Binance API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}