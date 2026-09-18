import { classifyTransaction } from "../src/utils/transactionClassifier.js";
import { withDeterminedConsideration } from "../src/utils/consideration.js";
import { computeAllTdsRows } from "../src/utils/tdsDiscrepancy.js";

const cases = [
  {
    name: "VDA → INR",
    row: { type: "SELL", asset: "BTC", assetType: "VDA", amount: 0.05, price: 5600000, quoteCurrency: "INR" },
    expectedType: "VDA_TO_INR",
    expectedTds: 2800,
  },
  {
    name: "VDA → foreign currency",
    row: { type: "SELL", asset: "BTC", assetType: "VDA", amount: 0.01, price: 64500, quoteCurrency: "USDT", fxRateInr: 87 },
    expectedType: "VDA_TO_FOREIGN_CURRENCY",
    expectedTds: 561.15,
  },
  {
    name: "VDA → VDA",
    row: {
      type: "SELL",
      asset: "BTC",
      assetType: "VDA",
      amount: 0.01,
      receivedAsset: "ETH",
      receivedAssetType: "VDA",
      receivedAmount: 0.181818,
      receivedAssetFmvInrPerUnit: 310000,
    },
    expectedType: "VDA_TO_VDA",
    expectedTds: 563.64,
  },
  {
    name: "Own-wallet movement",
    row: { type: "WITHDRAWAL", asset: "BTC", assetType: "VDA", amount: 0.03, sourceOwner: "SELF", destinationOwner: "SELF" },
    expectedType: "OWN_VDA_MOVEMENT",
    expectedTdsRows: 0,
  },
  {
    name: "VDA transfer to another owner",
    row: { type: "TRANSFER", asset: "ETH", assetType: "VDA", amount: 0.5, sourceOwner: "SELF", destinationOwner: "OTHER" },
    expectedType: "VDA_OWNERSHIP_TRANSFER",
    expectedTdsRows: 0,
  },
  {
    name: "Unknown wallet ownership",
    row: { type: "WITHDRAWAL", asset: "ETH", assetType: "VDA", amount: 0.25 },
    expectedType: "VDA_MOVEMENT_OWNERSHIP_UNKNOWN",
    expectedTdsRows: 0,
  },
];

const normalizedRows = [];
for (const test of cases) {
  const classification = classifyTransaction(test.row);
  console.log(`${test.name}: ${classification.status} | ${classification.transferType} | ${classification.confidence}%`);
  if (classification.transferType !== test.expectedType) {
    throw new Error(`${test.name}: expected ${test.expectedType}, got ${classification.transferType}`);
  }
  normalizedRows.push(
    withDeterminedConsideration({
      ...test.row,
      exchange: "TEST",
      date: "2026-07-01",
      tdsStatus: test.name === "VDA → INR" ? "DEDUCTED" : "UNKNOWN",
      tdsAmount: test.name === "VDA → INR" ? 2800 : null,
      refId: test.name,
    })
  );
}

const tdsRows = computeAllTdsRows(normalizedRows);
console.log("TDS rows included:", tdsRows.map((r) => `${r.transactionId}=${r.expectedTds}`).join(", "));

if (tdsRows.length !== 3) throw new Error(`Expected 3 seller-side TDS rows, got ${tdsRows.length}`);
for (const test of cases.filter((x) => x.expectedTds != null)) {
  const row = tdsRows.find((r) => r.transactionId === test.name);
  if (!row || row.expectedTds !== test.expectedTds) {
    throw new Error(`${test.name}: expected TDS ${test.expectedTds}, got ${row?.expectedTds}`);
  }
}

if (tdsRows.some((r) => r.transferType === "OWN_VDA_MOVEMENT")) {
  throw new Error("Own-wallet movement incorrectly entered 194S TDS calculation");
}

console.log("\nPASS: VDA classification, consideration, and TDS gating tests passed.");
