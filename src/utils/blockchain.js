import { BrowserProvider, JsonRpcProvider, Contract, parseUnits } from "ethers";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_RPC_URL || "https://testnetrpc.mstblockchain.com";
const CHAIN_ID_HEX = import.meta.env.VITE_CHAIN_ID_HEX || "0x5752035";
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || "MST Testnet";
const CURRENCY_SYMBOL = import.meta.env.VITE_CURRENCY_SYMBOL || "tMSTC";
const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "https://testnet.mstscan.com";
const BRIDGEKEY_RDNS = "io.bridgekey.wallet";

// Keep a minimum priority fee in case RPC estimates fall below the network's
// accepted floor; a relative bump alone cannot correct an estimate that is low.
const MIN_PRIORITY_FEE = parseUnits("30", "gwei");

const ABI = [
  "function anchorReport(bytes32 reportHash) external",
  "function verifyReport(bytes32 reportHash) external view returns (bool found, address submitter, uint256 timestamp)",
];

// True once VITE_CONTRACT_ADDRESS is set (after you deploy, local or real) —
// lets the app fall back to the mock flow until then, with no other code
// changes needed.
export const isChainConfigured = Boolean(CONTRACT_ADDRESS);

export function discoverBridgeKeyProvider() {
  return new Promise((resolve, reject) => {
    const handleAnnouncement = (event) => {
      if (event.detail?.info?.rdns !== BRIDGEKEY_RDNS || !event.detail.provider) return;
      window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
      window.clearTimeout(timeoutId);
      resolve(event.detail.provider);
    };

    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
      reject(new Error("BridgeKey wallet not found. Install or enable BridgeKey to continue."));
    }, 1000);

    window.addEventListener("eip6963:announceProvider", handleAnnouncement);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  });
}

// Switches only the discovered BridgeKey provider to the configured network.
async function ensureConfiguredNetwork(bridgeKeyProvider) {
  try {
    await bridgeKeyProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await bridgeKeyProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: CHAIN_NAME,
            nativeCurrency: {
              name: CURRENCY_SYMBOL,
              symbol: CURRENCY_SYMBOL,
              decimals: 18,
            },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: EXPLORER_URL ? [EXPLORER_URL] : [],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/**
 * Get safe gas settings for the blockchain transaction.
 *
 * Adds a 20% safety margin on top of the network's own fee estimate, AND
 * enforces an absolute minimum priority fee (MIN_PRIORITY_FEE) — a network
 * may reject transactions below its own floor regardless of how generous a
 * *relative* bump on top of a too-low base estimate is. EIP-1559 networks
 * use maxFeePerGas/maxPriorityFeePerGas; legacy networks fall back to
 * gasPrice.
 */
async function getSafeGasSettings(provider, contract, reportHash) {
  // Estimate the actual gas required by the contract call.
  const gasLimit = await contract.anchorReport.estimateGas("0x" + reportHash);

  // Some RPC endpoints do not implement eth_maxPriorityFeePerGas,
  // which ethers may call from getFeeData(). Fall back to the standard
  // eth_gasPrice RPC method instead of letting fee discovery abort the
  // transaction before BridgeKey can submit it.
  let feeData = null;
  try {
    feeData = await provider.getFeeData();
  } catch (error) {
    console.warn("RPC fee-data method unavailable; falling back to eth_gasPrice.", error?.message || error);
  }

  // Add a 20% safety margin to the estimated gas limit.
  const safeGasLimit = (gasLimit * 120n) / 100n;

  // Prefer EIP-1559 fee parameters when supported.
  if (feeData?.maxFeePerGas && feeData?.maxPriorityFeePerGas) {
    const bumpedPriority = (feeData.maxPriorityFeePerGas * 120n) / 100n;
    const safePriorityFeePerGas =
      bumpedPriority > MIN_PRIORITY_FEE ? bumpedPriority : MIN_PRIORITY_FEE;

    const bumpedMaxFee = (feeData.maxFeePerGas * 120n) / 100n;
    // maxFeePerGas must always be >= maxPriorityFeePerGas, or the network
    // rejects the transaction outright no matter how the priority fee
    // itself was computed.
    const safeMaxFeePerGas =
      bumpedMaxFee > safePriorityFeePerGas ? bumpedMaxFee : safePriorityFeePerGas * 2n;

    return {
      gasLimit: safeGasLimit,
      maxFeePerGas: safeMaxFeePerGas,
      maxPriorityFeePerGas: safePriorityFeePerGas,
    };
  }

  // Fallback for legacy networks and RPCs without eth_maxPriorityFeePerGas.
  // eth_gasPrice is broadly supported as a legacy fee field and provides a
  // fresh network price per attempt.
  if (feeData?.gasPrice) {
    const bumpedGasPrice = (feeData.gasPrice * 120n) / 100n;
    const safeGasPrice = bumpedGasPrice > MIN_PRIORITY_FEE ? bumpedGasPrice : MIN_PRIORITY_FEE;
    return { gasLimit: safeGasLimit, gasPrice: safeGasPrice };
  }

  try {
    const gasPriceHex = await provider.send("eth_gasPrice", []);
    const gasPrice = BigInt(gasPriceHex);
    const bumpedGasPrice = (gasPrice * 120n) / 100n;
    const safeGasPrice = bumpedGasPrice > MIN_PRIORITY_FEE ? bumpedGasPrice : MIN_PRIORITY_FEE;
    return { gasLimit: safeGasLimit, gasPrice: safeGasPrice };
  } catch (error) {
    throw new Error(
      `The network did not provide usable gas fee information: ${error?.message || error}`
    );
  }
}

// Writes the hash on-chain. Requires BridgeKey with funds on the configured
// network. Returns the real tx hash
// and block number.
export async function anchorReportOnChain(reportHashHex) {
  const bridgeKeyProvider = await discoverBridgeKeyProvider();
  const provider = new BrowserProvider(bridgeKeyProvider);

  // Request account access FIRST.
  await provider.send("eth_requestAccounts", []);

  // Switch to the configured blockchain network.
  await ensureConfiguredNetwork(bridgeKeyProvider);

  const signer = await provider.getSigner();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  // Calculate safe gas/fee settings using current network data, then send
  // directly — no queue, no buffer, nothing to get out of sync.
  const gasSettings = await getSafeGasSettings(provider, contract, reportHashHex);
  const tx = await contract.anchorReport("0x" + reportHashHex, gasSettings);
  const receipt = await tx.wait();

  return {
    network: CHAIN_NAME,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    timestamp: new Date().toISOString(),
    reportHash: reportHashHex,
    verificationUrl: `${window.location.origin}${window.location.pathname}#/verify/${reportHashHex}`,
  };
}

// Read-only check — free, no wallet or gas needed.
// Uses the configured RPC directly so anyone can verify without connecting
// BridgeKey.
export async function verifyReportOnChain(reportHashHex) {
  if (!RPC_URL || !CONTRACT_ADDRESS) {
    throw new Error(
      "Contract not configured yet — set VITE_CONTRACT_ADDRESS and VITE_RPC_URL."
    );
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);

  const bytes32Hash = "0x" + reportHashHex;
  const [found, submitter, timestamp] = await contract.verifyReport(bytes32Hash);

  return {
    found,
    submitter,
    timestamp: found ? new Date(Number(timestamp) * 1000).toISOString() : null,
  };
}