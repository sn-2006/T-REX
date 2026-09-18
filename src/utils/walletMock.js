// Fallback used when VITE_WALLET_RPC_URL isn't configured — see
// adapters/walletAdapter.js for the real Alchemy-backed implementation.
// Fabricates a couple of plausible rows so the "wallet as a stopover" path
// can still be demoed offline / without an Alchemy key.
export function mockWalletTransfers(address) {
  if (!address || address.trim().length < 4) return [];

  // Each wallet gets its own node name (suffixed by the last 4 chars of its
  // address) instead of a shared generic "Wallet" — otherwise adding a
  // second wallet would silently collapse both into the same flow-graph node.
  const label = `Wallet ${address.slice(-4)}`;

  return [
    {
      exchange: label,
      date: "2026-06-08",
      type: "DEPOSIT",
      asset: "ETH",
      amount: 0.4,
      inrValue: 0,
      tdsStatus: "NOT_APPLICABLE",
      refId: `WALLET-${address.slice(-6)}-1`,
    },
    {
      exchange: label,
      date: "2026-06-09",
      type: "WITHDRAWAL",
      asset: "ETH",
      amount: 0.4,
      inrValue: 0,
      tdsStatus: "NOT_APPLICABLE",
      refId: `WALLET-${address.slice(-6)}-2`,
    },
  ];
}
