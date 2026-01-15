const { ethers } = require("ethers");

class BettingEngine {
  constructor({ prisma, pollingService, web3Service, marketDefinitions, bettingCloseSeconds }) {
    this.prisma = prisma;
    this.pollingService = pollingService;
    this.web3Service = web3Service;
    this.marketDefinitions = marketDefinitions;
    this.bettingCloseSeconds = bettingCloseSeconds;
    this.intervalHandle = null;
  }

  start() {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.settlePendingBets().catch((error) => {
        console.error("Settlement error:", error.message || error);
      });
    }, 5000);
  }

  getAllowedPicks(market) {
    return Object.keys(market.odds || {});
  }

  serializeMatch(liveMatch, storedMatch, elapsed) {
    if (liveMatch) {
      return {
        ...liveMatch,
        elapsed
      };
    }

    if (!storedMatch) return null;

    const startTimestamp = storedMatch.startTimestamp
      ? storedMatch.startTimestamp.getTime()
      : null;

    return {
      match_id: storedMatch.matchId, // Use the string ID from DB
      server_steam_id: storedMatch.serverSteamId, // Note: Ensure this field exists in Schema if needed, otherwise ignore
      startTimestamp,
      elapsed,
      score_radiant: null, // Stored matches might not have live score data unless you add columns
      score_dire: null,
      radiant_heroes: storedMatch.radiantHeroes ? JSON.parse(storedMatch.radiantHeroes) : [], // If you store as JSON string
      dire_heroes: storedMatch.direHeroes ? JSON.parse(storedMatch.direHeroes) : [],
      game_mode: null,
      lobby_type: null,
      average_mmr: null,
      parties: [],
      lastSeen: null
    };
  }

  getElapsedForBet(matchId, storedMatch) {
    const liveElapsed = this.pollingService.getElapsedSeconds(matchId);
    if (liveElapsed != null) return liveElapsed;
    if (storedMatch && storedMatch.startTime) {
      return Math.floor((Date.now() - storedMatch.startTime.getTime()) / 1000);
    }
    return null;
  }

  async placeBet({ matchId, pick, market, wallet, txHash }) {
    const marketDef = this.marketDefinitions[market];
    if (!matchId) throw new Error("Bad matchId");
    if (!marketDef) throw new Error("Bad market");
    if (!wallet) throw new Error("Bad wallet");

    const allowedPicks = this.getAllowedPicks(marketDef);
    if (!allowedPicks.includes(pick)) throw new Error("Bad pick");

    const elapsed = this.pollingService.getElapsedSeconds(matchId);
    if (elapsed == null || elapsed > this.bettingCloseSeconds) {
      throw new Error("Betting closed");
    }

    const existing = await this.prisma.bet.findUnique({ where: { txHash } });
    if (existing) throw new Error("Tx already used");

    const stake = await this.web3Service.verifyTx(txHash, wallet);
    const minStake = ethers.utils.parseUnits("1", this.web3Service.getTokenMeta().decimals);
    if (stake.lt(minStake)) throw new Error(`Min 1 ${this.web3Service.getTokenMeta().symbol}`);

    const walletLc = wallet.toLowerCase();
    
    // FIX: Using 'wallet' to match the updated Schema
    const user = await this.prisma.user.upsert({
      where: { wallet: walletLc },
      update: {},
      create: { wallet: walletLc }
    });

    const matchIdStr = String(matchId);
    const liveMatch = this.pollingService.getMatchById(matchIdStr);
    
    // Prepare match data (saving heroes as strings for SQLite)
    const matchData = liveMatch
      ? {
          startTime: liveMatch.startTimestamp ? new Date(liveMatch.startTimestamp) : null,
          radiantHeroes: liveMatch.radiant_heroes ? JSON.stringify(liveMatch.radiant_heroes) : null,
          direHeroes: liveMatch.dire_heroes ? JSON.stringify(liveMatch.dire_heroes) : null,
        }
      : {};

    await this.prisma.match.upsert({
      where: { matchId: matchIdStr }, // search by the unique matchId string
      update: matchData,
      create: { 
        matchId: matchIdStr,
        ...matchData 
      }
    });

    const initialScore = liveMatch
      ? `${liveMatch.score_radiant}-${liveMatch.score_dire}`
      : "0-0";

    await this.prisma.bet.create({
      data: {
        match: { connect: { matchId: matchIdStr } }, // Connect via unique matchId
        user: { connect: { id: user.id } },
        market, // Using 'market' directly as defined in Schema
        pick,
        amount: stake.toString(), // Schema uses 'amount' (String)
        txHash,
        status: "PENDING",
      }
    });

    return { success: true };
  }

  async listBets() {
    const bets = await this.prisma.bet.findMany({
      include: { user: true, match: true },
      orderBy: { createdAt: "asc" }
    });

    return bets.map((bet) => {
      // Safety check in case match relation is missing
      if (!bet.match) return null;
      
      const liveMatch = this.pollingService.getMatchById(bet.match.matchId);
      const elapsed = this.getElapsedForBet(bet.match.matchId, bet.match);
      const matchPayload = this.serializeMatch(liveMatch, bet.match, elapsed);

      return {
        id: bet.id,
        matchId: bet.match.matchId,
        pick: bet.pick,
        market: bet.market,
        wallet: bet.user.wallet, // FIX: Matches Schema
        txHash: bet.txHash,
        amountWeiStr: bet.amount,
        status: bet.status,
        timestamp: bet.createdAt.getTime(),
        initialScore: "0-0", // If you didn't add initialScore to Schema, default it
        match: matchPayload,
        bettingClosed: elapsed != null ? elapsed > this.bettingCloseSeconds : true
      };
    }).filter(Boolean);
  }

  async settlePendingBets() {
    const pending = await this.prisma.bet.findMany({
      where: { status: "PENDING" },
      include: { match: true, user: true }
    });

    for (const bet of pending) {
      if (!bet.match) continue; // Safety check
      
      const marketDef = this.marketDefinitions[bet.market];
      if (!marketDef) continue;

      const settleAt = marketDef.timer;
      const snapshotKey = marketDef.snapshotSeconds || settleAt;
      const elapsed = this.getElapsedForBet(bet.match.matchId, bet.match);

      if (elapsed == null || elapsed < settleAt) continue;

      const snapshot = this.pollingService.getSnapshot(bet.match.matchId, snapshotKey);
      if (!snapshot) {
        // Void if significantly past time and no snapshot found
        if (elapsed > settleAt + 18000) {
          await this.prisma.bet.update({
            where: { id: bet.id },
            data: { status: "VOID" }
          });
        }
        continue;
      }

      const outcome = marketDef.resolve({ snapshot, elapsed });
      if (!outcome) continue;

      if (bet.pick === outcome) {
        const odd = marketDef.odds[bet.pick];
        const stake = ethers.BigNumber.from(bet.amount);
        const payout = stake.mul(odd.num).div(odd.den);

        // FIX: Using 'wallet' here too
        const paid = await this.web3Service.payWinner(bet.user.wallet, payout);
        
        // Note: Your schema didn't have payoutTx/resultInfo columns, 
        // so I am only updating status. Add those columns to Schema if you need them.
        await this.prisma.bet.update({
          where: { id: bet.id },
          data: {
            status: "WON",
          }
        });
      } else {
        await this.prisma.bet.update({
          where: { id: bet.id },
          data: {
            status: "LOST",
          }
        });
      }
    }
  }
}

module.exports = BettingEngine;