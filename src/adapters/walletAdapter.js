import { JsonRpcProvider } from "ethers";
import { withDeterminedConsideration } from "../utils/consideration.js";

// Real wallet reads via Alchemy's Enhanced API (alchemy_getAssetTransfers).
// Same contract as the exchange adapters: normalizes to the row shape
// parseExchangeCSV produces (exchange, date, type, asset, amount, inrValue,
// tdsStatus, refId), so wallet-sourced rows feed the same reconciliation
// pipeline with zero branching downstream.
//
// Configure VITE_WALLET_RPC_URL with an Alchemy HTTPS app URL for whichever
// network you want to read (e.g. Sepolia: https://eth-sepolia.g.alchemy.com/v2/<key>).
// Leave it blank to keep running on mockWalletTransfers — see walletMock.js.

const RPC_URL = import.meta.env.VITE_WALLET_RPC_URL;

export const isWalletApiConfigured = Boolean(RPC_URL);

let provider = null;
function getProvider() {
  if (!provider) provider = new JsonRpcProvider(RPC_URL);
  return provider;
}

// alchemy_getAssetTransfers pages results; a prototype-sized cap keeps this
// simple. Bump maxCount / add pageKey looping if a wallet has heavy history.
const MAX_COUNT_HEX = "0x64"; // 100

async function getTransfers(address, direction) {
  const params = [
    {
      fromBlock: "0x0",
      toBlock: "latest",
      category: ["external", "erc20"],
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: MAX_COUNT_HEX,
      ...(direction === "in" ? { toAddress: address } : { fromAddress: address }),
    },
  ];

  const res = await getProvider().send("alchemy_getAssetTransfers", params);
  return (res?.transfers || []).map((t) => ({ ...t, __direction: direction }));
}

function normalize(transfer, label) {
  const timestamp = transfer.metadata?.blockTimestamp;
  return withDeterminedConsideration({
    exchange: label,
    date: timestamp ? timestamp.slice(0, 10) : "",
    type: transfer.__direction === "in" ? "DEPOSIT" : "WITHDRAWAL",
    asset: transfer.asset || (transfer.category === "external" ? "ETH" : "TOKEN"),
    assetType: "VDA",
    amount: typeof transfer.value === "number" ? transfer.value : Number(transfer.value) || 0,
    // Alchemy returns the asset amount, not fiat value — this prototype has
    // no price oracle wired up, so INR value stays 0 here just like the
    // mock did. Wire in a price feed before using this for real TDS calculations.
    inrValue: 0,
    tdsStatus: "NOT_APPLICABLE",
    refId: `${transfer.hash}-${transfer.uniqueId ?? ""}`,
  });
}

export async function fetchWalletTransfers(address) {
  if (!address || address.trim().length < 4) return [];
  if (!isWalletApiConfigured) {
    const err = new Error("Wallet API not configured — set VITE_WALLET_RPC_URL in .env.");
    err.isWalletFetchError = true;
    throw err;
  }

  const trimmed = address.trim();
  const label = `Wallet ${trimmed.slice(-4)}`;

  try {
    const [incoming, outgoing] = await Promise.all([
      getTransfers(trimmed, "in"),
      getTransfers(trimmed, "out"),
    ]);

    return [...incoming, ...outgoing]
      .map((t) => normalize(t, label))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    const err = new Error(`Couldn't fetch transfers for ${label} (${trimmed}): ${e.message}`);
    err.isWalletFetchError = true;
    throw err;
  }
}
