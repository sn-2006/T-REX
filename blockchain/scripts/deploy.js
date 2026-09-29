const hre = require("hardhat");

// Frontend env values to print after deploying, per network.
const NETWORK_INFO = {
  mstTestnet: {
    rpcUrl: process.env.MST_RPC_URL || process.env.MST_TESTNET_RPC_URL || "https://testnetrpc.mstblockchain.com",
    chainIdHex: "0x5752035",
    chainName: "MST Testnet",
    currencySymbol: "tMSTC",
    explorerUrl: "https://testnet.mstscan.com",
  },
  localhost: {
    rpcUrl: "http://127.0.0.1:8545",
    chainIdHex: "0x7a69", // 31337
    chainName: "Hardhat Local",
    currencySymbol: "ETH",
    explorerUrl: "",
  },
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = deployer ? await deployer.getAddress() : "Unknown";

  console.log("=================================================");
  console.log("   ChainTDSRegistry Contract Deployment Summary   ");
  console.log("=================================================");
  console.log(`Network Name : ${hre.network.name}`);
  console.log(`Deployer/Owner: ${deployerAddress}`);

  const ChainTDSRegistry = await hre.ethers.getContractFactory("ChainTDSRegistry");
  const registry = await ChainTDSRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  const txHash = deployTx ? deployTx.hash : "N/A";
  const info = NETWORK_INFO[hre.network.name] || {};

  console.log(`Contract Addr: ${address}`);
  console.log(`Deploy Tx Hash: ${txHash}`);
  console.log(`Artifact Path: blockchain/artifacts/contracts/ChainTDSRegistry.sol/ChainTDSRegistry.json`);

  // Environment-based auditor auto-authorization (optional, validated)
  const initialAuditor = process.env.INITIAL_AUDITOR_ADDRESS || process.env.AUDITOR_ADDRESS;
  if (initialAuditor) {
    if (hre.ethers.isAddress(initialAuditor)) {
      console.log(`\nAuthorizing initial auditor wallet: ${initialAuditor}...`);
      const authTx = await registry.setAuditorAuthorization(initialAuditor, true);
      await authTx.wait();
      console.log(`✓ Auditor authorized on-chain (Tx: ${authTx.hash})`);
    } else {
      console.warn(`\n⚠️  INITIAL_AUDITOR_ADDRESS format invalid ("${initialAuditor}"). Skipped auto-authorization.`);
    }
  } else {
    console.log(`\nNote: Deployer (${deployerAddress}) is authorized by default.`);
    console.log(`To authorize additional auditor wallets later, run:`);
    console.log(`  contract.setAuditorAuthorization("<auditor_wallet_address>", true);`);
  }

  console.log("\n=================================================");
  console.log("Add/update these lines in the root frontend .env:");
  console.log("=================================================");
  console.log(`VITE_CONTRACT_ADDRESS=${address}`);
  if (info.rpcUrl) console.log(`VITE_RPC_URL=${info.rpcUrl}`);
  if (info.chainIdHex) console.log(`VITE_CHAIN_ID_HEX=${info.chainIdHex}`);
  if (info.chainName) console.log(`VITE_CHAIN_NAME=${info.chainName}`);
  if (info.currencySymbol) console.log(`VITE_CURRENCY_SYMBOL=${info.currencySymbol}`);
  if (info.explorerUrl) console.log(`VITE_EXPLORER_URL=${info.explorerUrl}`);
  console.log("=================================================\n");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});

