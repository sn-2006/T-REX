import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config({ path: "./server/.env" });

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE_URL =
  process.env.BINANCE_API_BASE_URL || "https://api.binance.com";

if (!API_KEY || !API_SECRET) {
  console.error("❌ Binance API credentials are missing.");
  console.error("Check server/.env");
  process.exit(1);
}

// Test symbol
const symbol = "BTCUSDT";
const limit = 20;

const timestamp = Date.now();

const queryString = new URLSearchParams({
  symbol,
  limit: String(limit),
  timestamp: String(timestamp),
}).toString();

// Binance HMAC SHA-256 signature
const signature = crypto
  .createHmac("sha256", API_SECRET)
  .update(queryString)
  .digest("hex");

const url =
  `${BASE_URL}/api/v3/myTrades?` +
  `${queryString}&signature=${signature}`;

console.log("======================================");
console.log("T-REX Binance API Test");
console.log("======================================");
console.log(`Symbol: ${symbol}`);
console.log(`Limit: ${limit}`);
console.log("Connecting to Binance...");

try {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": API_KEY,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("\n❌ Binance API request failed.");
    console.error("HTTP Status:", response.status);
    console.error("Response:", data);
    process.exit(1);
  }

  console.log("\n✅ Binance API connection successful!");
  console.log(`Trades received: ${data.length}`);

  console.log("\n--- Binance Response ---");
  console.log(JSON.stringify(data, null, 2));

} catch (error) {
  console.error("\n❌ Request failed:");
  console.error(error.message);
}