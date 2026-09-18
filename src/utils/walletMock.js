// Prototype stand-in for a real Alchemy call. In the full build this
// queries the given wallet address for its on-chain transfer history and
// normalizes it into the same row shape the CSV parser produces, so it can
// be reconciled alongside exchange data. Here it just fabricates a couple
// of plausible rows so the "wallet as a stopover" path can be demoed.
export function mockWalletTransfers(address) {
  if (!address || address.trim().length < 4) return [];

  return [
    {
      exchange: "Wallet",
      date: "2026-06-08",
      type: "DEPOSIT",
      asset: "ETH",
      amount: 0.4,
      inrValue: 0,
      tdsStatus: "NOT_APPLICABLE",
      refId: `WALLET-${address.slice(-6)}-1`,
    },
    {
      exchange: "Wallet",
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
