/**
 * DBET.LIVE — ONE-FILE WORKING DEMO (WITH: LIVE SCORE IN MY BETS + BUY DBET FROM POOL)
 * -----------------------------------------------------------------------------------
 * ✅ Fixes added:
 * 1) "My Bets" now shows:
 *    - Live score/time (from /api/games if match still tracked)
 *    - Settled score (snapshot) once resolved
 *
 * 2) Added "BUY DBET" flow:
 *    - Send native ETH to your DBETPool contract address
 *    - Pool automatically sends DBET back to user (vendor model)
 *
 * ⚠️ Notes:
 * - Your contract DBETPool is a TOKEN VENDOR (ETH -> DBET), NOT a betting escrow.
 * - Betting stakes still go to House wallet (demo bankroll), payouts come from House wallet.
 *
 * Setup
 * 1) npm i express cors axios ethers dotenv
 * 2) .env:
 *    HOUSE_PRIVATE_KEY=0x.... (Needed to PAY OUT winners)
 *    PORT=3000
 * 3) node dbet-live-onefile.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

// ============================
// CONFIG (Soneium Minato)
// ============================
const PORT = Number(process.env.PORT || 3000);
const RPC_URL = "https://rpc.minato.soneium.org";
const CHAIN_ID = 1946;
const CHAIN_ID_HEX = "0x79A"; // 1946

const DBET_TOKEN_ADDRESS = "0x16CfFC68F3C74E149f12eC96099132517e5D82e5";

// Your vendor pool (ETH -> DBET)
const DBET_POOL_ADDRESS = "0xAd7F468A179310B78dC5f919391A999B24730Fa0";

// House key is needed to PAY WINNERS
const HOUSE_PRIVATE_KEY = process.env.HOUSE_PRIVATE_KEY;
if (!HOUSE_PRIVATE_KEY) {
  console.error("❌ Missing HOUSE_PRIVATE_KEY in .env (Required for payouts)");
  process.exit(1);
}

// ============================
// RULES
// ============================
const POLL_INTERVAL_MS = 6000; // Poll every 6s
const MAX_LOBBY_SIZE = 5;
const MAX_ENTRY_AGE = 280; // Only add games younger than 4:40
const BETTING_CLOSE_SECONDS = 300; // Bets close strictly at 5:00

const SETTLE_5M = 300;
const SETTLE_10M = 600;

// payoutWei = stakeWei * num / den
const ODDS = {
  KILLS_5MIN: {
    Radiant: { num: 5, den: 2, display: 2.5 },
    Dire: { num: 5, den: 2, display: 2.5 },
    Draw: { num: 5, den: 1, display: 5.0 },
    settleSeconds: SETTLE_5M,
    closeSeconds: BETTING_CLOSE_SECONDS,
  },
  KILLS_10MIN: {
    Radiant: { num: 2, den: 1, display: 2.0 },
    Dire: { num: 2, den: 1, display: 2.0 },
    Draw: { num: 4, den: 1, display: 4.0 },
    settleSeconds: SETTLE_10M,
    closeSeconds: BETTING_CLOSE_SECONDS,
  },
};

// ============================
// STATE (in-memory)
// ============================
let persistentLobby = [];
let activeBets = [];
let gameStartTimes = Object.create(null);
let matchSnapshots = Object.create(null); // { matchId: { s5: {...}, s10: {...} } }

// Replay protection for on-chain tx hashes
const usedTx = new Set();

function nowMs() {
  return Date.now();
}
function bn(x) {
  return ethers.BigNumber.from(x);
}

function lockStartTimestamp(matchId, gameTimeSeconds) {
  const safeTime = Number.isFinite(Number(gameTimeSeconds)) ? Number(gameTimeSeconds) : 0;
  if (!gameStartTimes[matchId]) {
    gameStartTimes[matchId] = nowMs() - Math.max(0, safeTime) * 1000;
  }
  return gameStartTimes[matchId];
}

function elapsedSecondsFromStart(matchId) {
  const start = gameStartTimes[matchId];
  if (!start) return null;
  return Math.floor((nowMs() - start) / 1000);
}

function matchHasPendingBet(matchId) {
  return activeBets.some((b) => b.matchId === matchId && b.status === "PENDING");
}

// ============================
// ETHERS SETUP
// ============================
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const houseWallet = new ethers.Wallet(HOUSE_PRIVATE_KEY, provider);

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const tokenRead = new ethers.Contract(DBET_TOKEN_ADDRESS, ERC20_ABI, provider);
const tokenHouse = new ethers.Contract(DBET_TOKEN_ADDRESS, ERC20_ABI, houseWallet);

const ERC20_IFACE = new ethers.utils.Interface(ERC20_ABI);
const TRANSFER_TOPIC = ERC20_IFACE.getEventTopic("Transfer");

let TOKEN_DECIMALS = 18;
let TOKEN_SYMBOL = "DBET";

// ============================
// LOBBY POLLER (OpenDota)
// ============================
async function updateLobby() {
  try {
    // 1. Fetch Live Data with CACHE BUSTER
    const url = `https://api.opendota.com/api/live?_=${Date.now()}`;
    const res = await axios.get(url, { timeout: 8000 });
    const rawGames = Array.isArray(res.data) ? res.data : [];

    // 2. Parse & Validations
    const validGames = rawGames
      .filter((g) => {
        if (!g.players || g.players.length !== 10) return false;
        if (g.radiant_score === undefined || g.dire_score === undefined) return false;
        if (!g.players.every((p) => p.hero_id && p.hero_id > 0)) return false;
        return true;
      })
      .map((g) => {
        const startTs = lockStartTimestamp(g.match_id, g.game_time || 0);
        const elapsed = Math.floor((nowMs() - startTs) / 1000);
        return {
          ...g,
          startTimestamp: startTs,
          elapsed,
          server_steam_id: g.server_steam_id,
        };
      });

    // 3. Update Snapshots for Settlement
    for (const g of validGames) {
      if (!matchSnapshots[g.match_id]) matchSnapshots[g.match_id] = {};
      const snap = matchSnapshots[g.match_id];
      if (g.elapsed >= SETTLE_5M && !snap.s5) {
        snap.s5 = { r: g.radiant_score, d: g.dire_score, ts: nowMs() };
        console.log(`📸 Snapshot 5min [${g.match_id}]: ${g.radiant_score}-${g.dire_score}`);
      }
      if (g.elapsed >= SETTLE_10M && !snap.s10) {
        snap.s10 = { r: g.radiant_score, d: g.dire_score, ts: nowMs() };
        console.log(`📸 Snapshot 10min [${g.match_id}]: ${g.radiant_score}-${g.dire_score}`);
      }
    }

    // 4. Update Existing Persistent Lobby
    persistentLobby = persistentLobby
      .map((saved) => {
        const live = validGames.find((v) => v.match_id === saved.match_id);

        // If lost signal from API:
        if (!live) {
          const e = elapsedSecondsFromStart(saved.match_id) || saved.elapsed || 9999;
          // Keep if we have a bet, otherwise drop immediately
          if (matchHasPendingBet(saved.match_id) && e < SETTLE_10M + 120) {
            return { ...saved, elapsed: e };
          }
          return null;
        }

        // Update live data
        saved.elapsed = live.elapsed;
        saved.score_radiant = live.radiant_score;
        saved.score_dire = live.dire_score;
        saved.server_steam_id = live.server_steam_id;

        // If game is > 5:00 and NO bets, remove to make space for fresh games
        if (saved.elapsed >= BETTING_CLOSE_SECONDS && !matchHasPendingBet(saved.match_id)) {
          return null;
        }
        return saved;
      })
      .filter(Boolean);

    // 5. Refill Lobby with FRESH games
    if (persistentLobby.length < MAX_LOBBY_SIZE) {
      const slots = MAX_LOBBY_SIZE - persistentLobby.length;

      const candidates = validGames
        .filter((g) => {
          const inLobby = persistentLobby.find((p) => p.match_id === g.match_id);
          const isFresh = g.elapsed < MAX_ENTRY_AGE;
          const validTime = g.elapsed > -120;
          return !inLobby && isFresh && validTime;
        })
        .sort((a, b) => {
          // Prefer games that already started (>0)
          const aOk = a.elapsed > 0;
          const bOk = b.elapsed > 0;
          if (aOk && !bOk) return -1;
          if (!aOk && bOk) return 1;
          return a.elapsed - b.elapsed;
        });

      if (candidates.length > 0) {
        const toAdd = candidates.slice(0, slots);
        toAdd.forEach((g) => {
          persistentLobby.push({
            match_id: g.match_id,
            server_steam_id: g.server_steam_id,
            startTimestamp: g.startTimestamp,
            elapsed: g.elapsed,
            radiant_heroes: g.players.filter((p) => p.team === 0).map((p) => p.hero_id),
            dire_heroes: g.players.filter((p) => p.team === 1).map((p) => p.hero_id),
            score_radiant: g.radiant_score,
            score_dire: g.dire_score,
          });
          console.log(`➕ Added Match ${g.match_id} (Time: ${Math.floor(g.elapsed / 60)}:${g.elapsed % 60})`);
        });
      }
    }
  } catch (e) {
    console.log("⚠️ OpenDota Poll Error:", e.message);
  }
}

setInterval(updateLobby, POLL_INTERVAL_MS);

// ============================
// TX VERIFICATION
// ============================
async function verifyAndExtractBetTransfer({ txHash, user, expectedTo, expectedToken }) {
  if (!txHash || !ethers.utils.isHexString(txHash, 32)) throw new Error("Bad txHash");
  if (!ethers.utils.isAddress(user)) throw new Error("Bad wallet address");
  if (usedTx.has(txHash)) throw new Error("Tx already used");

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("Tx not mined yet");
  if (receipt.status !== 1) throw new Error("Tx failed");

  const tokenLc = expectedToken.toLowerCase();
  if (!receipt.to || receipt.to.toLowerCase() !== tokenLc) {
    throw new Error("Tx not sent to DBET token contract");
  }

  const userLc = user.toLowerCase();
  const toLc = expectedTo.toLowerCase();
  let amountWei = null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenLc) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    try {
      const parsed = ERC20_IFACE.parseLog(log);
      const from = String(parsed.args.from).toLowerCase();
      const to = String(parsed.args.to).toLowerCase();
      if (from === userLc && to === toLc) {
        amountWei = parsed.args.value;
        break;
      }
    } catch (_) {}
  }
  if (!amountWei) throw new Error("No Transfer to House found in logs");
  usedTx.add(txHash);
  return amountWei;
}

// ============================
// PAYOUT LOGIC
// ============================
async function payWinner(userAddress, payoutWeiBn) {
  try {
    const bal = await tokenHouse.balanceOf(houseWallet.address);
    if (bal.lt(payoutWeiBn)) return { ok: false, error: "HOUSE_INSOLVENT" };

    const tx = await tokenHouse.transfer(userAddress, payoutWeiBn);
    console.log(`💰 Payout Sent: ${tx.hash}`);
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    console.error("Payout Error:", e);
    return { ok: false, error: e.message || "PAYOUT_FAILED" };
  }
}

// ============================
// SETTLEMENT LOOP
// ============================
setInterval(async () => {
  if (activeBets.length === 0) return;

  for (const bet of activeBets) {
    if (bet.status !== "PENDING") continue;

    const rules = ODDS[bet.market];
    const elapsed = elapsedSecondsFromStart(bet.matchId);
    if (elapsed == null || elapsed < rules.settleSeconds) continue;

    const snap = matchSnapshots[bet.matchId] || {};
    const useSnap = rules.settleSeconds === SETTLE_5M ? snap.s5 : snap.s10;

    if (!useSnap) {
      if (elapsed > rules.settleSeconds + 180) {
        bet.status = "VOID";
        bet.resultInfo = "No snapshot (Void)";
      }
      continue;
    }

    const r = Number(useSnap.r);
    const d = Number(useSnap.d);
    const winner = r > d ? "Radiant" : d > r ? "Dire" : "Draw";
    bet.resultInfo = `${r} - ${d}`;

    if (bet.pick === winner) {
      bet.status = "WON";
      const odd = rules[bet.pick];
      const stake = bn(bet.amountWeiStr);
      const payout = stake.mul(odd.num).div(odd.den);

      bet.payoutWeiStr = payout.toString();
      const paid = await payWinner(bet.wallet, payout);
      bet.payoutTx = paid.ok ? paid.txHash : "FAILED";
      bet.payoutError = paid.error;
    } else {
      bet.status = "LOST";
      bet.payoutTx = "N/A";
    }
  }
}, 5000);

// ============================
// API
// ============================
app.get("/api/meta", (req, res) => {
  res.json({
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    rpcUrl: RPC_URL,
    token: { address: DBET_TOKEN_ADDRESS, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS },
    house: { address: houseWallet.address },
    pool: { address: DBET_POOL_ADDRESS }, // vendor pool
    rules: {
      closeSeconds: BETTING_CLOSE_SECONDS,
      markets: ODDS,
    },
  });
});

app.get("/api/games", (req, res) => res.json(persistentLobby));
app.get("/api/bets", (req, res) => res.json(activeBets));

app.post("/api/bet", async (req, res) => {
  try {
    const { matchId, pick, market, wallet, txHash } = req.body;

    if (!ODDS[market]) return res.status(400).json({ error: "Invalid market" });
    if (!["Radiant", "Dire", "Draw"].includes(pick)) return res.status(400).json({ error: "Invalid pick" });

    const elapsed = elapsedSecondsFromStart(matchId);
    if (elapsed == null) return res.status(400).json({ error: "Match not tracked" });
    if (elapsed >= ODDS[market].closeSeconds) return res.status(400).json({ error: "Betting Closed" });

    const stakeWei = await verifyAndExtractBetTransfer({
      txHash,
      user: wallet,
      expectedTo: houseWallet.address,
      expectedToken: DBET_TOKEN_ADDRESS,
    });

    const minWei = ethers.utils.parseUnits("1", TOKEN_DECIMALS);
    if (stakeWei.lt(minWei)) return res.status(400).json({ error: "Min bet 1 DBET" });

    // store some "initial" info (nice for UI fallback)
    const live = persistentLobby.find((g) => String(g.match_id) === String(matchId));
    const initialScore = live ? `${live.score_radiant} - ${live.score_dire}` : null;

    const bet = {
      id: Date.now() + Math.random(),
      matchId,
      pick,
      market,
      wallet,
      txHash,
      amountWeiStr: stakeWei.toString(),
      status: "PENDING",
      timestamp: Date.now(),
      startTimestamp: gameStartTimes[matchId],
      initialScore,
    };

    activeBets.push(bet);
    console.log(`✅ Bet Accepted: ${bet.id} on Match ${matchId}`);
    res.json({ success: true });
  } catch (e) {
    console.error("Bet Rejected:", e.message);
    res.status(400).json({ error: e.message });
  }
});

// ============================
// FRONTEND
// ============================
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>DBET.LIVE — Live Test</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js"></script>
  <style>
    body { background-color:#0F172A; color:white; font-family: ui-sans-serif,system-ui; }
    .hero-box { width:45px; height:26px; background:#1e293b; border-radius:3px; overflow:hidden; position:relative; border:1px solid #334155; }
    .hero-img { width:100%; height:100%; object-fit:cover; }
    .btn-market { transition:all .2s; font-weight:900; font-size:.72rem; padding:10px; border-radius:10px; text-transform:uppercase; letter-spacing:.06em; }
    .glass { background: rgba(30,41,59,.62); backdrop-filter: blur(10px); border-bottom:1px solid rgba(255,255,255,.08); }
    .mini-input { background: rgba(15,23,42,.4); border:1px solid rgba(148,163,184,.2); }
  </style>
</head>
<body>
<div id="root"></div>

<script type="text/babel">
const { useEffect, useState, useMemo } = React;

const HERO_NAMES = {1:"antimage",2:"axe",3:"bane",4:"bloodseeker",5:"crystal_maiden",6:"drow_ranger",7:"earthshaker",8:"juggernaut",9:"mirana",10:"morphling",11:"nevermore",12:"phantom_lancer",13:"puck",14:"pudge",15:"razor",16:"sand_king",17:"storm_spirit",18:"sven",19:"tiny",20:"vengefulspirit",21:"windrunner",22:"zuus",23:"kunkka",25:"lina",26:"lion",27:"shadow_shaman",28:"slardar",29:"tidehunter",30:"witch_doctor",31:"lich",32:"riki",33:"enigma",34:"tinker",35:"sniper",36:"necrolyte",37:"warlock",38:"beastmaster",39:"queenofpain",40:"venomancer",41:"faceless_void",42:"skeleton_king",43:"death_prophet",44:"phantom_assassin",45:"pugna",46:"templar_assassin",47:"viper",48:"luna",49:"dragon_knight",50:"dazzle",51:"rattletrap",52:"leshrac",53:"furion",54:"life_stealer",55:"dark_seer",56:"clinkz",57:"omniknight",58:"enchantress",59:"huskar",60:"night_stalker",61:"broodmother",62:"bounty_hunter",63:"weaver",64:"jakiro",65:"batrider",66:"chen",67:"spectre",68:"ancient_apparition",69:"doom_bringer",70:"ursa",71:"spirit_breaker",72:"gyrocopter",73:"alchemist",74:"invoker",75:"silencer",76:"obsidian_destroyer",77:"lycan",78:"brewmaster",79:"shadow_demon",80:"lone_druid",81:"chaos_knight",82:"meepo",83:"treant",84:"ogre_magi",85:"undying",86:"rubick",87:"disruptor",88:"nyx_assassin",89:"naga_siren",90:"keeper_of_the_light",91:"wisp",92:"visage",93:"slark",94:"medusa",95:"troll_warlord",96:"centaur",97:"magnataur",98:"shredder",99:"bristleback",100:"tusk",101:"skywrath_mage",102:"abaddon",103:"elder_titan",104:"legion_commander",105:"techies",106:"ember_spirit",107:"earth_spirit",108:"abyssal_underlord",109:"terrorblade",110:"phoenix",111:"oracle",112:"winter_wyvern",113:"arc_warden",114:"monkey_king",119:"dark_willow",120:"pangolier",121:"grimstroke",123:"hoodwink",126:"void_spirit",128:"snapfire",129:"mars",135:"dawnbreaker",136:"marci",137:"primal_beast",138:"muerta"};

function Hero({id}) {
  const name = HERO_NAMES[id] || "default";
  return (
    <div className="hero-box" title={name}>
      <img className="hero-img" src={\`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/\${name}.png\`} onError={(e)=>e.target.style.display='none'} />
    </div>
  );
}

function LiveTimer({ startTimestamp }) {
  const [e, setE] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setE(Math.floor((Date.now() - startTimestamp)/1000)), 1000);
    return () => clearInterval(t);
  }, [startTimestamp]);

  const mm = Math.floor(Math.max(0,e)/60);
  const ss = String(Math.max(0,e)%60).padStart(2,"0");
  const color = e < 120 ? "text-green-400" : e < 240 ? "text-yellow-400" : "text-red-400";
  return <span className={\`font-mono font-black \${color}\`}>{mm}:{ss}</span>;
}

function shortAddr(a) { return a ? a.slice(0,6)+"..."+a.slice(-4) : ""; }

function fmtMMSS(sec) {
  if (sec == null) return "??:??";
  const mm = Math.floor(Math.max(0,sec)/60);
  const ss = String(Math.max(0,sec)%60).padStart(2,"0");
  return \`\${mm}:\${ss}\`;
}

function App() {
  const [meta, setMeta] = useState(null);
  const [games, setGames] = useState([]);
  const [bets, setBets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState("0");
  const [betAmount, setBetAmount] = useState(100);
  const [buyEth, setBuyEth] = useState("0.01");
  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState(false);

  const refreshBalance = async (addr, metaArg) => {
    try {
      if (!addr || !metaArg || !window.ethereum) return;
      const p = new ethers.providers.Web3Provider(window.ethereum);
      const s = p.getSigner();
      const t = new ethers.Contract(metaArg.token.address, ["function balanceOf(address) view returns (uint)"], s);
      const b = await t.balanceOf(addr);
      setBalance(ethers.utils.formatUnits(b, metaArg.token.decimals));
    } catch(e) {}
  };

  const refresh = async () => {
    try {
      const m = await (await fetch("/api/meta")).json();
      setMeta(m);

      const g = await (await fetch("/api/games")).json();
      setGames(g);

      const b = await (await fetch("/api/bets")).json();
      setBets(b);

      if (wallet) await refreshBalance(wallet, m);
    } catch(e) { console.error(e); }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return ()=>clearInterval(t);
  }, [wallet]);

  const connect = async () => {
    if(!window.ethereum) return alert("No MetaMask");
    const p = new ethers.providers.Web3Provider(window.ethereum);
    await p.send("eth_requestAccounts", []);
    const s = p.getSigner();
    const a = await s.getAddress();
    setWallet(a);

    // Check Chain
    const n = await p.getNetwork();
    if(meta && n.chainId !== meta.chainId) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params:[{ chainId: meta.chainIdHex }]});
      } catch(e) {
        alert("Switch to Soneium Minato chain");
      }
    }

    if(meta) await refreshBalance(a, meta);
  };

  const copyCmd = (serverId) => {
    if (!serverId) return alert("Server ID not ready (wait a bit)");
    const cmd = \`watch_server \${serverId}\`;
    navigator.clipboard.writeText(cmd);
    alert(\`COPIED!\\n\\nOpen Dota 2 → Console (\\\\) → paste:\\n\${cmd}\`);
  };

  const placeBet = async (g, pick, market) => {
    if(!wallet) return alert("Connect Wallet First");
    setLoading(true);
    try {
      const p = new ethers.providers.Web3Provider(window.ethereum);
      const s = p.getSigner();

      const t = new ethers.Contract(meta.token.address, ["function transfer(address,uint) returns (bool)"], s);
      const amt = ethers.utils.parseUnits(String(betAmount), meta.token.decimals);

      const tx = await t.transfer(meta.house.address, amt);
      await tx.wait(1);

      const res = await fetch("/api/bet", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ matchId: g.match_id, pick, market, wallet, txHash: tx.hash })
      });
      const d = await res.json();
      if(!d.success) throw new Error(d.error);

      await refresh();
      alert("Bet Placed!");
    } catch(e) {
      alert(e.message || "Bet Failed");
    } finally {
      setLoading(false);
    }
  };

  // BUY DBET FROM VENDOR POOL (send ETH to pool, pool sends DBET back)
  const buyFromPool = async () => {
    if(!wallet) return alert("Connect Wallet First");
    if(!meta?.pool?.address) return alert("Pool address missing");
    setBuying(true);
    try {
      const p = new ethers.providers.Web3Provider(window.ethereum);
      const s = p.getSigner();

      const v = ethers.utils.parseEther(String(buyEth || "0"));
      if (v.lte(0)) throw new Error("Enter ETH amount > 0");

      const tx = await s.sendTransaction({
        to: meta.pool.address,
        value: v
      });

      await tx.wait(1);
      await refresh();
      alert("Purchase sent! DBET should arrive if pool has liquidity.");
    } catch(e) {
      alert(e.message || "Buy failed");
    } finally {
      setBuying(false);
    }
  };

  const myBets = useMemo(() => (
    bets.filter(b => wallet && b.wallet.toLowerCase() === wallet.toLowerCase()).reverse()
  ), [bets, wallet]);

  // Map for quick lookup of live game for "My Bets"
  const gameById = useMemo(() => {
    const m = new Map();
    games.forEach(g => m.set(String(g.match_id), g));
    return m;
  }, [games]);

  return (
    <div className="min-h-screen pb-20">
      <div className="glass sticky top-0 z-50 p-4 mb-6 shadow-lg">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tighter italic">DBET<span className="text-blue-500">.LIVE</span></h1>
            <div className="text-[10px] text-slate-400 font-mono">Live eSports Betting • Soneium Minato</div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center w-full lg:w-auto">
            {/* Stake */}
            <div className="bg-slate-800 rounded-lg flex items-center px-3 py-2 gap-2 border border-slate-700">
              <span className="text-[10px] text-slate-400 font-black">STAKE</span>
              <input type="number" value={betAmount} onChange={e=>setBetAmount(e.target.value)}
                className="w-20 bg-transparent text-right font-black outline-none" />
              <span className="text-[10px] text-slate-500">{meta?.token?.symbol || "DBET"}</span>
            </div>

            {/* Buy from Pool */}
            <div className="bg-slate-800 rounded-lg flex items-center px-3 py-2 gap-2 border border-slate-700">
              <span className="text-[10px] text-slate-400 font-black">BUY</span>
              <input value={buyEth} onChange={e=>setBuyEth(e.target.value)}
                className="w-20 text-right font-black outline-none bg-transparent" />
              <span className="text-[10px] text-slate-500">ETH</span>
              <button onClick={buyFromPool} disabled={!wallet || buying}
                className="ml-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-2 rounded-lg font-black text-[10px] uppercase">
                {buying ? "Buying..." : "Buy DBET"}
              </button>
            </div>

            {/* Wallet */}
            {!wallet ?
              <button onClick={connect} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg font-black text-xs">
                CONNECT WALLET
              </button> :
              <div className="text-right">
                <div className="text-sm font-black text-green-400">{Number(balance).toFixed(0)} {meta?.token?.symbol || "DBET"}</div>
                <div className="text-[10px] text-slate-500 font-mono">{shortAddr(wallet)}</div>
              </div>
            }
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LOBBY */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-black text-slate-300">Live Matches</h2>

          {games.length === 0 && (
            <div className="p-12 text-center border-2 border-dashed border-slate-800 rounded-2xl text-slate-500 animate-pulse">
              Scanning OpenDota for fresh games...
            </div>
          )}

          {games.map(g => {
            const elapsed = Math.floor((Date.now() - g.startTimestamp)/1000);
            const locked = elapsed >= 300;

            return (
              <div key={g.match_id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden group">
                {/* Header Row */}
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-mono">ID: {g.match_id}</span>
                    <button onClick={() => copyCmd(g.server_steam_id)}
                      className="bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white px-2 py-1 rounded text-[10px] font-black uppercase transition-colors border border-blue-500/30">
                      📋 Watch
                    </button>
                  </div>
                </div>

                {/* Scoreboard */}
                <div className="flex justify-center items-center mb-6 gap-6">
                  <div className="text-2xl font-black text-green-500">{g.score_radiant}</div>
                  <div className="bg-slate-800 px-3 py-1 rounded text-sm"><LiveTimer startTimestamp={g.startTimestamp} /></div>
                  <div className="text-2xl font-black text-red-500">{g.score_dire}</div>
                </div>

                {/* Heroes */}
                <div className="flex justify-between items-center mb-6 px-2">
                  <div className="flex gap-0.5">{g.radiant_heroes.map((h,i)=><Hero key={i} id={h}/>)}</div>
                  <div className="text-[10px] text-slate-600 font-black">VS</div>
                  <div className="flex gap-0.5">{g.dire_heroes.map((h,i)=><Hero key={i} id={h}/>)}</div>
                </div>

                {/* Markets */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    {m:"KILLS_5MIN", label:"Kills @ 5:00", odds: meta?.rules?.markets?.KILLS_5MIN},
                    {m:"KILLS_10MIN", label:"Kills @ 10:00", odds: meta?.rules?.markets?.KILLS_10MIN}
                  ].map(market => (
                    <div key={market.m} className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                      <div className="flex justify-between mb-2">
                        <div className="text-[10px] font-black uppercase text-blue-400">{market.label}</div>
                        {locked && <div className="text-[10px] text-red-500 font-black">LOCKED</div>}
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {["Radiant","Draw","Dire"].map(pick => (
                          <button
                            key={pick}
                            disabled={locked || loading}
                            onClick={()=>placeBet(g, pick, market.m)}
                            className="btn-market bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200"
                          >
                            {pick} <span className="text-blue-300 block text-[9px]">x{market.odds?.[pick]?.display}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* HISTORY */}
        <div>
          <h2 className="text-xl font-black text-slate-300 mb-6">My Bets</h2>
          <div className="space-y-3">
            {myBets.map(b => {
              const live = gameById.get(String(b.matchId));
              const liveScore = live ? \`\${live.score_radiant} - \${live.score_dire}\` : (b.initialScore || "N/A");
              const liveElapsed = live ? Math.floor((Date.now() - live.startTimestamp)/1000) : null;

              return (
                <div key={b.id} className={\`p-4 rounded-xl border-l-4 \${b.status==="WON"?"border-green-500 bg-green-900/20": b.status==="PENDING"?"border-yellow-500 bg-yellow-900/10":"border-red-500 bg-red-900/10"}\`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-slate-300">{b.market}</span>
                    <span className="text-[10px] font-mono opacity-75">{b.status}</span>
                  </div>

                  <div className="mt-1 text-sm text-slate-200">
                    Pick: <span className="font-black">{b.pick}</span>
                  </div>

                  {/* LIVE SCORE (while pending or if match still in lobby) */}
                  <div className="mt-2 text-[10px] text-slate-400 bg-black/20 inline-flex gap-2 px-2 py-1 rounded">
                    <span>Live: {liveScore}</span>
                    <span className="opacity-70">{liveElapsed != null ? \`t=\${fmtMMSS(liveElapsed)}\` : ""}</span>
                  </div>

                  {/* SETTLED SCORE */}
                  {b.resultInfo && (
                    <div className="mt-2 text-[10px] text-slate-300 bg-black/30 inline-flex gap-2 px-2 py-1 rounded">
                      <span>Settled: {b.resultInfo}</span>
                    </div>
                  )}

                  <div className="mt-3 text-[10px] text-slate-500 font-mono flex justify-between">
                    <span>Match: {b.matchId}</span>
                    {b.status==="WON" && <span>Payout Tx: {shortAddr(b.payoutTx)}</span>}
                  </div>
                </div>
              )
            })}

            {!wallet && <div className="text-slate-600 text-sm text-center">Connect wallet to see history</div>}

            {/* small footer */}
            {wallet && meta?.pool?.address && (
              <div className="text-[10px] text-slate-600 mt-6">
                Vendor Pool: <span className="font-mono">{meta.pool.address}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
</script>
</body>
</html>
`;

app.get("/", (req, res) => res.send(HTML_TEMPLATE));

// ============================
// BOOT
// ============================
(async () => {
  try {
    TOKEN_DECIMALS = await tokenRead.decimals();
  } catch (_) {}
  try {
    TOKEN_SYMBOL = await tokenRead.symbol();
  } catch (_) {}

  console.log("---------------------------------------");
  console.log("🟢 DBET.LIVE BACKEND STARTED");
  console.log("   House Address:", houseWallet.address);
  console.log("   Token Address:", DBET_TOKEN_ADDRESS);
  console.log("   Vendor Pool   :", DBET_POOL_ADDRESS);
  console.log("---------------------------------------");

  // Initial Fetch
  await updateLobby();

  app.listen(PORT, () => {
    console.log("Server ready at http://localhost:" + PORT);

  });
})();
