import { BrowserProvider, JsonRpcProvider, Contract, parseUnits } from "ethers";

const CONTRACT_ADDRESS =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CONTRACT_ADDRESS) ||
  process.env.VITE_CONTRACT_ADDRESS;
const RPC_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_RPC_URL) ||
  process.env.VITE_RPC_URL ||
  "https://testnetrpc.mstblockchain.com";
const CHAIN_ID_HEX =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CHAIN_ID_HEX) ||
  process.env.VITE_CHAIN_ID_HEX ||
  "0x5752035";
const CHAIN_NAME =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CHAIN_NAME) ||
  process.env.VITE_CHAIN_NAME ||
  "MST Testnet";
const CURRENCY_SYMBOL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CURRENCY_SYMBOL) ||
  process.env.VITE_CURRENCY_SYMBOL ||
  "tMSTC";
const EXPLORER_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_EXPLORER_URL) ||
  process.env.VITE_EXPLORER_URL ||
  "https://testnet.mstscan.com";
const BRIDGEKEY_RDNS = "io.bridgekey.wallet";

// Keep a minimum priority fee in case RPC estimates fall below the network's
// accepted floor; a relative bump alone cannot correct an estimate that is low.
const MIN_PRIORITY_FEE = parseUnits("30", "gwei");

export const ABI = [
  "function anchorReport(bytes32 reportHash) external",
  "function verifyReport(bytes32 reportHash) external view returns (bool found, address submitter, uint256 timestamp)",
  "function issueComplianceCertificate(bytes32 reportHash, address taxpayer, uint8 status, uint256 validUntil) external returns (bytes32 certId)",
  "function getComplianceCertificate(bytes32 reportHash) external view returns (bytes32 certId, bytes32 reportHashOut, address auditor, address taxpayer, uint8 status, uint256 issuedAt, uint256 validUntil, bool revoked, string revocationReason, bool exists)",
  "function getComplianceCertificateById(bytes32 certId) external view returns (bytes32 certIdOut, bytes32 reportHash, address auditor, address taxpayer, uint8 status, uint256 issuedAt, uint256 validUntil, bool revoked, string revocationReason, bool exists)",
  "function verifyComplianceCertificate(bytes32 reportHash) external view returns (bool valid, address auditor, uint8 status, uint256 issuedAt, uint256 validUntil, bool revoked)",
  "function revokeComplianceCertificate(bytes32 reportHash, string calldata reason) external",
  "event ReportAnchored(bytes32 indexed reportHash, address indexed submitter, uint256 timestamp)",
  "event CertificateIssued(bytes32 indexed certId, bytes32 indexed reportHash, address indexed auditor, address taxpayer, uint8 status, uint256 issuedAt, uint256 validUntil)",
  "event CertificateRevoked(bytes32 indexed certId, bytes32 indexed reportHash, address indexed auditor, string reason)",
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
 * enforces an absolute minimum priority fee (MIN_PRIORITY_FEE).
 */
async function getSafeGasSettings(provider, contract, methodName, ...args) {
  let gasLimit = 300000n;
  try {
    gasLimit = await contract[methodName].estimateGas(...args);
  } catch (error) {
    console.warn(`RPC gas estimation unavailable for ${methodName}; using safe fallback limit.`, error?.message || error);
  }

  let feeData = null;
  try {
    feeData = await provider.getFeeData();
  } catch (error) {
    console.warn("RPC fee-data method unavailable; falling back to eth_gasPrice.", error?.message || error);
  }

  const safeGasLimit = (gasLimit * 120n) / 100n;

  if (feeData?.maxFeePerGas && feeData?.maxPriorityFeePerGas) {
    const bumpedPriority = (feeData.maxPriorityFeePerGas * 120n) / 100n;
    const safePriorityFeePerGas =
      bumpedPriority > MIN_PRIORITY_FEE ? bumpedPriority : MIN_PRIORITY_FEE;

    const bumpedMaxFee = (feeData.maxFeePerGas * 120n) / 100n;
    const safeMaxFeePerGas =
      bumpedMaxFee > safePriorityFeePerGas ? bumpedMaxFee : safePriorityFeePerGas * 2n;

    return {
      gasLimit: safeGasLimit,
      maxFeePerGas: safeMaxFeePerGas,
      maxPriorityFeePerGas: safePriorityFeePerGas,
    };
  }

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

// Writes the hash on-chain. Requires BridgeKey with funds on the configured network.
export async function anchorReportOnChain(reportHashHex) {
  const bridgeKeyProvider = await discoverBridgeKeyProvider();
  const provider = new BrowserProvider(bridgeKeyProvider);

  await provider.send("eth_requestAccounts", []);
  await ensureConfiguredNetwork(bridgeKeyProvider);

  const signer = await provider.getSigner();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  const gasSettings = await getSafeGasSettings(provider, contract, "anchorReport", "0x" + reportHashHex);
  const tx = await contract.anchorReport("0x" + reportHashHex, gasSettings);
  const receipt = await tx.wait();

  return {
    network: CHAIN_NAME,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    timestamp: new Date().toISOString(),
    reportHash: reportHashHex,
    verificationUrl: typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}#/verify/${reportHashHex}` : "",
  };
}

// Read-only check — free, no wallet or gas needed.
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

/**
 * Issues an MST Compliance Certificate on-chain via an authorized auditor's BridgeKey wallet.
 * Waits for transaction confirmation before returning details.
 */
export async function issueCertificateOnChain(optionsOrHash, taxpayerAddress, status = 1, validUntil = 0) {
  let reportHashHex;
  let safeTaxpayer = "0x0000000000000000000000000000000000000000";
  let certStatus = 1;
  let certValidUntil = 0n;

  if (typeof optionsOrHash === "object" && optionsOrHash !== null) {
    reportHashHex = optionsOrHash.reportHashHex || optionsOrHash.reportHash;
    if (optionsOrHash.taxpayerAddress && typeof optionsOrHash.taxpayerAddress === "string" && optionsOrHash.taxpayerAddress.startsWith("0x")) {
      safeTaxpayer = optionsOrHash.taxpayerAddress;
    }
    if (optionsOrHash.status !== undefined) certStatus = Number(optionsOrHash.status);
    if (optionsOrHash.validUntil !== undefined) certValidUntil = BigInt(optionsOrHash.validUntil);
  } else {
    reportHashHex = optionsOrHash;
    if (taxpayerAddress && typeof taxpayerAddress === "string" && taxpayerAddress.startsWith("0x")) {
      safeTaxpayer = taxpayerAddress;
    }
    if (status !== undefined) certStatus = Number(status);
    if (validUntil !== undefined) certValidUntil = BigInt(validUntil);
  }

  if (!reportHashHex) {
    throw new Error("A valid report hash is required to issue a compliance certificate.");
  }

  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract not configured yet — set VITE_CONTRACT_ADDRESS.");
  }

  const bridgeKeyProvider = await discoverBridgeKeyProvider();
  const provider = new BrowserProvider(bridgeKeyProvider);

  await provider.send("eth_requestAccounts", []);
  await ensureConfiguredNetwork(bridgeKeyProvider);

  const signer = await provider.getSigner();
  const auditorAddress = await signer.getAddress();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  const bytes32Hash = reportHashHex.startsWith("0x") ? reportHashHex : "0x" + reportHashHex;

  const gasSettings = await getSafeGasSettings(
    provider,
    contract,
    "issueComplianceCertificate",
    bytes32Hash,
    safeTaxpayer,
    certStatus,
    certValidUntil
  );

  const tx = await contract.issueComplianceCertificate(
    bytes32Hash,
    safeTaxpayer,
    certStatus,
    certValidUntil,
    gasSettings
  );

  const receipt = await tx.wait();

  let certId = null;
  if (receipt && receipt.logs) {
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === "CertificateIssued") {
          certId = parsed.args.certId;
          break;
        }
      } catch {}
    }
  }

  return {
    certId: certId || null,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    contractAddress: CONTRACT_ADDRESS,
    auditorAddress,
    timestamp: new Date().toISOString(),
    network: CHAIN_NAME,
    reportHash: reportHashHex,
    verificationUrl: typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}#/verify/${reportHashHex}` : "",
  };
}

/**
 * Verifies an MST Compliance Certificate on-chain (read-only query via JsonRpcProvider).
 */
export async function verifyCertificateOnChain(reportHashHex) {
  if (!RPC_URL || !CONTRACT_ADDRESS) {
    throw new Error(
      "Contract not configured yet — set VITE_CONTRACT_ADDRESS and VITE_RPC_URL."
    );
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);

  const bytes32Hash = reportHashHex.startsWith("0x") ? reportHashHex : "0x" + reportHashHex;

  const [valid, auditor, status, issuedAt, validUntil, revoked] =
    await contract.verifyComplianceCertificate(bytes32Hash);

  let details = null;
  if (valid || revoked) {
    try {
      const c = await contract.getComplianceCertificate(bytes32Hash);
      if (c && c.exists) {
        details = {
          certId: c.certId,
          reportHash: c.reportHashOut || c.reportHash,
          auditor: c.auditor,
          taxpayer: c.taxpayer,
          status: Number(c.status),
          issuedAt: c.issuedAt ? new Date(Number(c.issuedAt) * 1000).toISOString() : null,
          validUntil: c.validUntil > 0n ? new Date(Number(c.validUntil) * 1000).toISOString() : null,
          revoked: c.revoked,
          revocationReason: c.revocationReason,
          exists: c.exists,
        };
      }
    } catch {}
  }

  return {
    valid,
    auditor,
    status: Number(status),
    issuedAt: issuedAt ? new Date(Number(issuedAt) * 1000).toISOString() : null,
    validUntil: validUntil > 0n ? new Date(Number(validUntil) * 1000).toISOString() : null,
    revoked,
    details,
  };
}

/**
 * Mock fallback function for certificate issuance when no real contract address is configured.
 */
export function mockIssueCertificateOnChain(reportHashHex, auditorAddress = "0xAUD170R000000000000000000000000000000000") {
  const fakeTxHash =
    "0x" +
    Array.from({ length: 64 }, () =>
      "0123456789abcdef"[Math.floor(Math.random() * 16)]
    ).join("");
  const fakeCertId =
    "0x" +
    Array.from({ length: 64 }, () =>
      "0123456789abcdef"[Math.floor(Math.random() * 16)]
    ).join("");

  return {
    certId: fakeCertId,
    txHash: fakeTxHash,
    blockNumber: 12_400_000 + Math.floor(Math.random() * 5000),
    contractAddress: CONTRACT_ADDRESS || "0xSimulatedContractAddress",
    auditorAddress,
    timestamp: new Date().toISOString(),
    network: "MST Testnet (simulated)",
    reportHash: reportHashHex,
    verificationUrl: typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}#/verify/${reportHashHex}` : "",
  };
}