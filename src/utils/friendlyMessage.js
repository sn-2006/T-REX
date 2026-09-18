export function getFriendlyBlockchainMessage(error) {
  const message = String(error?.message || error || "").toLowerCase();

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
    message.includes("gas") ||
    message.includes("fee") ||
    message.includes("underpriced")
  ) {
    return "The network fee changed before the transaction could be submitted. Please try again so we can calculate a fresh network fee.";
  }

  if (
    message.includes("revert") ||
    message.includes("execution reverted")
  ) {
    return "The blockchain rejected this transaction. The report could not be anchored on-chain.";
  }

  return "We couldn't complete the blockchain transaction right now. Please check your wallet and network connection and try again.";
}