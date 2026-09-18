import { BrowserProvider, JsonRpcProvider, Contract } from "ethers";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_RPC_URL;
const CHAIN_ID_HEX = import.meta.env.VITE_CHAIN_ID_HEX || "0x13882"; // defaults to Polygon Amoy
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || "Polygon Amoy";
const CURRENCY_SYMBOL = import.meta.env.VITE_CURRENCY_SYMBOL || "POL";
const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "";

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
            nativeCurrency: { name: CURRENCY_SYMBOL, symbol: CURRENCY_SYMBOL, decimals: 18 },
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

// Writes the hash on-chain. Requires MetaMask (or another injected wallet)
// with funds on whichever network is configured. Returns the real tx hash
// and block number.
export async function anchorReportOnChain(reportHashHex) {
  if (!window.ethereum) {
    throw new Error("No wallet found — install MetaMask to anchor a report on-chain.");
  }

  await ensureConfiguredNetwork();

  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);

  const signer = await provider.getSigner();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  const bytes32Hash = "0x" + reportHashHex;
  const tx = await contract.anchorReport(bytes32Hash);
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

// Read-only check — free, no wallet or gas needed. Uses the configured RPC
// directly so anyone can verify without installing MetaMask.
export async function verifyReportOnChain(reportHashHex) {
  if (!RPC_URL || !CONTRACT_ADDRESS) {
    throw new Error("Contract not configured yet — set VITE_CONTRACT_ADDRESS and VITE_RPC_URL.");
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
