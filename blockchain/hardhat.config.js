require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { MST_RPC_URL, MST_TESTNET_RPC_URL, PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    mstTestnet: {
      url: MST_RPC_URL || MST_TESTNET_RPC_URL || "https://testnetrpc.mstblockchain.com",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 91562037,
    },
  },
};
