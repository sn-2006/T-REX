const hre = require("hardhat");

// Frontend env values to print after deploying, per network.
const NETWORK_INFO = {
  amoy: {
    rpcUrl: process.env.AMOY_RPC_URL,
    chainIdHex: "0x13882", // 80002
    chainName: "Polygon Amoy",
    currencySymbol: "POL",
    explorerUrl: "https://amoy.polygonscan.com",
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
  const ChainTDSRegistry = await hre.ethers.getContractFactory("ChainTDSRegistry");
  const registry = await ChainTDSRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const info = NETWORK_INFO[hre.network.name] || {};

  console.log(`\nChainTDSRegistry deployed to ${hre.network.name}:`, address);
  console.log("\nAdd these lines to the frontend's .env file:");
  console.log(`VITE_CONTRACT_ADDRESS=${address}`);
  if (info.rpcUrl) console.log(`VITE_RPC_URL=${info.rpcUrl}`);
  if (info.chainIdHex) console.log(`VITE_CHAIN_ID_HEX=${info.chainIdHex}`);
  if (info.chainName) console.log(`VITE_CHAIN_NAME=${info.chainName}`);
  if (info.currencySymbol) console.log(`VITE_CURRENCY_SYMBOL=${info.currencySymbol}`);
  if (info.explorerUrl) console.log(`VITE_EXPLORER_URL=${info.explorerUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
