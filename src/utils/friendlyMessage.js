export function getFriendlyBlockchainMessage(error) {
  const message = String(error?.message || error || "").toLowerCase();

  const duplicateReportSignals = [
    "already anchored",
    "report already anchored",
    "hash already anchored",
    "report already exists",
    "already submitted",
    "duplicate report",
    "same report",
    "same csv",
    "same wallet",
    "same wallet address",
    "same api",
    "same api key",
    "csv files are being used",
    "wallet address is being used",
    "wallet addr is being used",
    "api keys are being used",
    "reused csv",
    "reused wallet",
    "reused api",
    "reused api key",
    "files are being used",
    "wallets are being used",
    "api keys are reused",
    "csv files are reused",
  ];

  if (duplicateReportSignals.some((signal) => message.includes(signal))) {
    return "The same CSV files, wallet addresses, or API credentials are being reused for this report. Please change at least one input or generate a fresh report.";
  }

  if (
    message.includes("user rejected") ||
    message.includes("action_rejected") ||
    message.includes("user denied")
  ) {
    return "The transaction was cancelled in MetaMask. No blockchain transaction was submitted.";
  }

  if (
    message.includes("insufficient funds") ||
    message.includes("insufficient_funds")
  ) {
    return "The transaction could not be submitted because the wallet does not have enough funds to pay the network fee.";
  }

  const lowFeeSignals = [
    "underpriced",
    "fee too low",
    "gas price too low",
    "max fee per gas",
    "maxpriorityfee",
    "priority fee too low",
    "fee cap too low",
    "replacement transaction underpriced",
    "network fee changed before the transaction could be submitted",
    "fee changed before the transaction could be submitted",
  ];

  if (lowFeeSignals.some((signal) => message.includes(signal))) {
    return "The network fee changed before the transaction could be submitted. Please try again so we can calculate a fresh network fee.";
  }

  if (
    message.includes("network") ||
    message.includes("rpc") ||
    message.includes("could not connect")
  ) {
    return "The blockchain network could not process the transaction right now. Please try again in a moment.";
  }

  if (
    message.includes("nonce") ||
    message.includes("replacement transaction")
  ) {
    return "Another blockchain transaction is already pending from this wallet. Please wait for it to complete and try again.";
  }

  if (
    message.includes("revert") ||
    message.includes("execution reverted")
  ) {
    return "The blockchain rejected this transaction. The report could not be anchored on-chain.";
  }

  return "We couldn't complete the blockchain transaction right now. Please check your wallet and network connection and try again.";
}