require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");

/** Local chain for development (Polygon PoS-compatible EVM). Amoy/mainnet via env vars — never commit keys. */
module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    amoy: { url: process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology", chainId: 80002,
      accounts: process.env.CHAIN_PRIVATE_KEY ? [process.env.CHAIN_PRIVATE_KEY] : [] },
    polygon: { url: process.env.POLYGON_RPC || "https://polygon-rpc.com", chainId: 137,
      accounts: process.env.CHAIN_PRIVATE_KEY ? [process.env.CHAIN_PRIVATE_KEY] : [] },
  },
};
