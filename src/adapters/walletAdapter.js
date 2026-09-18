import { apiFetch } from "../api/client";

// Decentralized wallet adapter.
// The browser sends only the public wallet address to the T-REX backend.
// Alchemy and MetaSleuth credentials stay server-side.

export const SUPPORTED_WALLET_CHAINS = [
  { key: "ethereum", label: "Ethereum Mainnet", chainId: 1 },
];

export async function fetchWalletAnalysis(address, chain = "ethereum", options = {}) {
  if (chain !== "ethereum") throw new Error("Ethereum Mainnet is the first supported decentralized network.");
  return apiFetch("/wallet/analyze", {
    method: "POST",
    body: { address, ...options },
  });
}

// Compatibility helper for callers that explicitly need normalized wallet
// rows. The normal wallet-analysis UI does not request them, which keeps the
// large on-chain provenance response lightweight.
export async function fetchWalletTransfers(address) {
  const result = await fetchWalletAnalysis(address, "ethereum", { includeNormalizedRows: true });
  return result.normalizedRows || [];
}
