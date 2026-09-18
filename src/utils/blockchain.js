import { BrowserProvider, JsonRpcProvider, Contract, parseUnits } from "ethers";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_RPC_URL;
const CHAIN_ID_HEX = import.meta.env.VITE_CHAIN_ID_HEX || "0x13882"; // defaults to Polygon Amoy
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || "Polygon Amoy";
const CURRENCY_SYMBOL = import.meta.env.VITE_CURRENCY_SYMBOL || "POL";
const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "";

// Polygon networks (Amoy included) enforce their own minimum priority fee —
// historically 25-30 gwei — no matter what a generic EVM fee-estimation
// heuristic thinks is reasonable. provider.getFeeData() on Amoy frequently
// returns a number BELOW that floor, so a relative "+20%" bump on top of an
// already-too-low estimate is still too low. That's why the failure was
// consistent (same underpriced number every time) instead of intermittent.
const MIN_PRIORITY_FEE = parseUnits("30", "gwei");

const ABI = [
  "function anchorReport(bytes32 reportHash) external",
  "function verifyReport(bytes32 reportHash) external view returns (bool found, address submitter, uint256 timestamp)",
];

// True once VITE_CONTRACT_ADDRESS is set (after you deploy, local or real) —
// lets the app fall back to the mock flow until then, with no other code
// changes needed.
export const isChainConfigured = Boolean(CONTRACT_ADDRESS);

// Asks MetaMask to switch to whichever network is configured, and if it
// doesn't recognize it yet, asks it to add it — using our own configured
// RPC URL. Works the same whether that's Polygon Amoy or a local Hardhat
// node, since both are just "some EVM chain" as far as MetaMask cares.
async function ensureConfiguredNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    // 4902 = MetaMask doesn't recognize this chain yet — add it.
    if (switchError.code === 4902) {
      await window.ethereum.request({
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
 * enforces an absolute minimum priority fee (MIN_PRIORITY_FEE) — Polygon
 * rejects transactions below its own floor regardless of how generous a
 * *relative* bump on top of a too-low base estimate is. EIP-1559 networks
 * use maxFeePerGas/maxPriorityFeePerGas; legacy networks fall back to
 * gasPrice.
 */
async function getSafeGasSettings(provider, contract, reportHash) {
  const feeData = await provider.getFeeData();

  // Estimate the actual gas required by the contract call.
  const gasLimit = await contract.anchorReport.estimateGas("0x" + reportHash);

  // Add a 20% safety margin to the estimated gas limit.
  const safeGasLimit = (gasLimit * 120n) / 100n;

  // Prefer EIP-1559 fee parameters when supported.
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
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

  // Fallback for legacy networks.
  if (feeData.gasPrice) {
    const bumpedGasPrice = (feeData.gasPrice * 120n) / 100n;
    const safeGasPrice = bumpedGasPrice > MIN_PRIORITY_FEE ? bumpedGasPrice : MIN_PRIORITY_FEE;
    return { gasLimit: safeGasLimit, gasPrice: safeGasPrice };
  }

  throw new Error("The network did not provide usable gas fee information.");
}

// Writes the hash on-chain. Requires MetaMask (or another injected wallet)
// with funds on whichever network is configured. Returns the real tx hash
// and block number.
export async function anchorReportOnChain(reportHashHex) {
  if (!window.ethereum) {
    throw new Error("No wallet found — install MetaMask to anchor a report on-chain.");
  }

  const provider = new BrowserProvider(window.ethereum);

  // Request account access FIRST.
  await provider.send("eth_requestAccounts", []);

  // Switch to the configured blockchain network.
  await ensureConfiguredNetwork();

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
// Uses the configured RPC directly so anyone can verify without installing
// MetaMask.
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