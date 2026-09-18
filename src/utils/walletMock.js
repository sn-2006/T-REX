// Prototype stand-in for a real Alchemy call. In the full build this
// queries the given wallet address for its on-chain transfer history and
// normalizes it into the same row shape the CSV parser produces, so it can
// be reconciled alongside exchange data. Here it just fabricates a couple
// of plausible rows so the "wallet as a stopover" path can be demoed.
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
