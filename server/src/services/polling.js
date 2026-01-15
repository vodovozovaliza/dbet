const axios = require("axios");

const PROXY_LIST = [
  { protocol: "http", host: "201.134.41.110", port: 443 },
  { protocol: "http", host: "190.110.226.122", port: 80 },
  { protocol: "http", host: "118.193.37.241", port: 3129 },
  { protocol: "http", host: "101.32.34.4", port: 8118 },
  { protocol: "http", host: "190.130.6.11", port: 8080 },
  { protocol: "http", host: "86.123.65.26", port: 80 },
  { protocol: "http", host: "102.223.9.53", port: 80 },
  { protocol: "http", host: "61.29.96.146", port: 8000 },
  { protocol: "http", host: "94.79.152.14", port: 80 }
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function summarizeParties(players) {
  const groups = new Map();
  for (const p of players || []) {
    if (!p || p.party_id == null) continue;
    const id = String(p.party_id);
    if (!groups.has(id)) groups.set(id, { party_id: id, count: 0, radiant: 0, dire: 0 });
    const g = groups.get(id);
    g.count += 1;
    if (p.team === 0) g.radiant += 1;
    if (p.team === 1) g.dire += 1;
  }
  const arr = [...groups.values()].filter((x) => x.count >= 2);
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, 6);
}

class PollingService {
  constructor({ basePollIntervalMs, opendotaApiKey, marketDefinitions, bettingCloseSeconds }) {
    this.basePollIntervalMs = basePollIntervalMs;
    this.opendotaApiKey = opendotaApiKey;
    this.marketDefinitions = marketDefinitions;
    this.bettingCloseSeconds = bettingCloseSeconds;

    this.trackedMatches = new Map();
    this.matchSnapshots = Object.create(null);
    this.gameStartTimes = Object.create(null);
    this.cooldownUntil = 0;
    this.started = false;

    this.snapshotTargets = this.getSnapshotTargets();
  }

  getSnapshotTargets() {
    const targets = new Set();
    for (const market of Object.values(this.marketDefinitions || {})) {
      const target = market.snapshotSeconds || market.timer;
      if (Number.isFinite(target)) targets.add(target);
    }
    return [...targets.values()].sort((a, b) => a - b);
  }

  nowMs() {
    return Date.now();
  }

  lockStartTimestamp(matchId, gameTimeSeconds) {
    const safeTime = Number.isFinite(Number(gameTimeSeconds)) ? Number(gameTimeSeconds) : 0;
    if (!this.gameStartTimes[matchId]) {
      this.gameStartTimes[matchId] = this.nowMs() - Math.max(0, safeTime) * 1000;
    }
    return this.gameStartTimes[matchId];
  }

  elapsedSecondsFromStart(matchId) {
    const start = this.gameStartTimes[matchId];
    if (!start) return null;
    return Math.floor((this.nowMs() - start) / 1000);
  }

  async fetchWithFallback(baseUrl) {
    let url = baseUrl;
    if (this.opendotaApiKey) {
      url += (url.includes("?") ? "&" : "?") + `api_key=${this.opendotaApiKey}`;
    }

    const ua = getRandomUserAgent();
    const headers = {
      "User-Agent": ua,
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.dota2.com/",
      "Origin": "https://www.dota2.com"
    };

    try {
      const res = await axios.get(url, { headers, timeout: 8000 });
      return res.data;
    } catch (error) {
      const status = error.response ? error.response.status : 0;
      const isBlock = status === 429 || status === 403;
      if (!isBlock && status !== 0) {
        throw error;
      }

      for (const proxy of PROXY_LIST) {
        try {
          const res = await axios.get(url, {
            headers,
            timeout: 6000,
            proxy
          });
          return res.data;
        } catch (proxyErr) {
          continue;
        }
      }
      throw new Error("All connections (direct + proxy) failed.");
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.schedulePoll(0);
  }

  schedulePoll(delayMs) {
    setTimeout(() => {
      this.updateLobby().catch((error) => {
        console.error("Polling error:", error.message || error);
      });
    }, delayMs);
  }

  async updateLobby() {
    if (this.nowMs() < this.cooldownUntil) {
      this.schedulePoll(this.basePollIntervalMs);
      return;
    }

    try {
      const url = `https://api.opendota.com/api/live?_=${this.nowMs()}`;
      const data = await this.fetchWithFallback(url);
      const rawGames = Array.isArray(data) ? data : [];

      const validGames = rawGames
        .filter((g) => {
          if (!g) return false;
          if (!g.players || g.players.length !== 10) return false;
          if (!g.match_id) return false;
          if (g.radiant_score === undefined || g.dire_score === undefined) return false;
          return true;
        })
        .map((g) => {
          const matchId = String(g.match_id);
          const startTs = this.lockStartTimestamp(matchId, g.game_time || 0);
          const elapsed = Math.floor((this.nowMs() - startTs) / 1000);

          return {
            match_id: matchId,
            server_steam_id: g.server_steam_id,
            startTimestamp: startTs,
            elapsed,
            score_radiant: g.radiant_score,
            score_dire: g.dire_score,
            radiant_heroes: g.players.filter((p) => p.team === 0).map((p) => p.hero_id),
            dire_heroes: g.players.filter((p) => p.team === 1).map((p) => p.hero_id),
            game_mode: g.game_mode ?? null,
            lobby_type: g.lobby_type ?? null,
            average_mmr: g.average_mmr ?? null,
            parties: summarizeParties(g.players),
            lastSeen: this.nowMs()
          };
        });

      for (const g of validGames) {
        this.trackedMatches.set(g.match_id, g);

        if (!this.matchSnapshots[g.match_id]) this.matchSnapshots[g.match_id] = {};
        const snap = this.matchSnapshots[g.match_id];
        for (const t of this.snapshotTargets) {
          if (g.elapsed >= t && !snap[t]) {
            snap[t] = { r: g.score_radiant, d: g.score_dire, ts: this.nowMs() };
          }
        }
      }

      const pruneStaleMs = 15 * 60 * 1000;
      for (const [matchId, match] of this.trackedMatches.entries()) {
        const elapsed = this.elapsedSecondsFromStart(matchId) ?? match.elapsed ?? 0;
        const stale = this.nowMs() - (match.lastSeen || 0) > pruneStaleMs;
        const tooLong = elapsed > 3 * 60 * 60;

        if (tooLong) {
          this.trackedMatches.delete(matchId);
        } else if (stale) {
          match.elapsed = elapsed;
        }
      }
    } catch (error) {
      if (error.response && error.response.status === 429) {
        const delay = 60000 + Math.floor(Math.random() * 60000);
        this.cooldownUntil = this.nowMs() + delay;
      } else {
        console.warn("Polling error:", error.message || error);
      }
    }

    const jitter = Math.floor(Math.random() * 5000);
    this.schedulePoll(this.basePollIntervalMs + jitter);
  }

  getTrackedMatches() {
    return [...this.trackedMatches.values()];
  }

  getMatchById(matchId) {
    return this.trackedMatches.get(String(matchId));
  }

  getElapsedSeconds(matchId) {
    return this.elapsedSecondsFromStart(String(matchId));
  }

  getSnapshot(matchId, seconds) {
    const bucket = this.matchSnapshots[String(matchId)];
    return bucket ? bucket[seconds] || null : null;
  }

  isBettingOpen(matchId) {
    const elapsed = this.getElapsedSeconds(matchId);
    if (elapsed == null) return false;
    return elapsed <= this.bettingCloseSeconds;
  }
}

module.exports = PollingService;
