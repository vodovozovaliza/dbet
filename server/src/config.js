require("dotenv").config();

const config = {
  port: Number(process.env.PORT || 3000),
  rpcUrl: process.env.RPC_URL || "https://rpc.minato.soneium.org",
  chainId: Number(process.env.CHAIN_ID || 1946),
  chainIdHex: process.env.CHAIN_ID_HEX || "0x79A",
  tokenAddress: process.env.DBET_TOKEN_ADDRESS || "0x16CfFC68F3C74E149f12eC96099132517e5D82e5",
  poolAddress: process.env.DBET_POOL_ADDRESS || "0xAd7F468A179310B78dC5f919391A999B24730Fa0",
  opendotaApiKey: process.env.OPENDOTA_API_KEY || "",
  housePrivateKey: process.env.HOUSE_PRIVATE_KEY || "",
  poolRateEthToDbet: Number(process.env.POOL_RATE_ETH_TO_DBET || 10000),
  basePollIntervalMs: Number(process.env.BASE_POLL_INTERVAL_MS || 45000),
  bettingCloseSeconds: Number(process.env.BETTING_CLOSE_SECONDS || 300)
};

module.exports = config;
