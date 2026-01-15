const path = require("path");
const express = require("express");
const cors = require("cors");

const config = require("./config");
const prisma = require("./db/prisma");
const MarketDefinitions = require("./services/marketDefinitions");
const PollingService = require("./services/polling");
const Web3Service = require("./services/web3");
const BettingEngine = require("./services/engine");

const app = express();
app.use(cors());
app.use(express.json());

const pollingService = new PollingService({
  basePollIntervalMs: config.basePollIntervalMs,
  opendotaApiKey: config.opendotaApiKey,
  marketDefinitions: MarketDefinitions,
  bettingCloseSeconds: config.bettingCloseSeconds
});

const web3Service = new Web3Service({
  rpcUrl: config.rpcUrl,
  tokenAddress: config.tokenAddress,
  housePrivateKey: config.housePrivateKey
});

const bettingEngine = new BettingEngine({
  prisma,
  pollingService,
  web3Service,
  marketDefinitions: MarketDefinitions,
  bettingCloseSeconds: config.bettingCloseSeconds
});

function serializeMarkets(definitions) {
  const payload = {};
  for (const [key, def] of Object.entries(definitions)) {
    payload[key] = {
      label: def.label,
      timer: def.timer,
      ...def.odds
    };
  }
  return payload;
}

app.get("/api/meta", (req, res) => {
  const tokenMeta = web3Service.getTokenMeta();
  res.json({
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    token: {
      address: config.tokenAddress,
      symbol: tokenMeta.symbol,
      decimals: tokenMeta.decimals
    },
    house: web3Service.getHouseAddress(),
    pool: {
      address: config.poolAddress,
      rateEthToDbet: config.poolRateEthToDbet
    },
    odds: serializeMarkets(MarketDefinitions),
    closeSeconds: config.bettingCloseSeconds
  });
});

app.get("/api/games", (req, res) => {
  const list = pollingService.getTrackedMatches();
  const filtered = list
    .map((match) => {
      const elapsed = pollingService.getElapsedSeconds(match.match_id) ?? match.elapsed ?? 0;
      return { ...match, elapsed };
    })
    .filter((match) => match.elapsed <= config.bettingCloseSeconds)
    .sort((a, b) => b.elapsed - a.elapsed);

  res.json(filtered);
});

app.get("/api/bets", async (req, res) => {
  try {
    const bets = await bettingEngine.listBets();
    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load bets" });
  }
});

app.post("/api/bet", async (req, res) => {
  try {
    const { matchId, pick, market, wallet, txHash } = req.body || {};
    const result = await bettingEngine.placeBet({ matchId, pick, market, wallet, txHash });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Bet failed" });
  }
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

async function start() {
  await web3Service.init();
  pollingService.start();
  bettingEngine.start();

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error.message || error);
  process.exit(1);
});
