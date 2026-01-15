import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

const HERO_MAP = {1:"antimage",2:"axe",3:"bane",4:"bloodseeker",5:"crystal_maiden",6:"drow_ranger",7:"earthshaker",8:"juggernaut",9:"mirana",10:"morphling",11:"nevermore",12:"phantom_lancer",13:"puck",14:"pudge",15:"razor",16:"sand_king",17:"storm_spirit",18:"sven",19:"tiny",20:"vengefulspirit",21:"windrunner",22:"zuus",23:"kunkka",25:"lina",26:"lion",27:"shadow_shaman",28:"slardar",29:"tidehunter",30:"witch_doctor",31:"lich",32:"riki",33:"enigma",34:"tinker",35:"sniper",36:"necrolyte",37:"warlock",38:"beastmaster",39:"queenofpain",40:"venomancer",41:"faceless_void",42:"skeleton_king",43:"death_prophet",44:"phantom_assassin",45:"pugna",46:"templar_assassin",47:"viper",48:"luna",49:"dragon_knight",50:"dazzle",51:"rattletrap",52:"leshrac",53:"furion",54:"life_stealer",55:"dark_seer",56:"clinkz",57:"omniknight",58:"enchantress",59:"huskar",60:"night_stalker",61:"broodmother",62:"bounty_hunter",63:"weaver",64:"jakiro",65:"batrider",66:"chen",67:"spectre",68:"ancient_apparition",69:"doom_bringer",70:"ursa",71:"spirit_breaker",72:"gyrocopter",73:"alchemist",74:"invoker",75:"silencer",76:"obsidian_destroyer",77:"lycan",78:"brewmaster",79:"shadow_demon",80:"lone_druid",81:"chaos_knight",82:"meepo",83:"treant",84:"ogre_magi",85:"undying",86:"rubick",87:"disruptor",88:"nyx_assassin",89:"naga_siren",90:"keeper_of_the_light",91:"wisp",92:"visage",93:"slark",94:"medusa",95:"troll_warlord",96:"centaur",97:"magnataur",98:"shredder",99:"bristleback",100:"tusk",101:"skywrath_mage",102:"abaddon",103:"elder_titan",104:"legion_commander",105:"techies",106:"ember_spirit",107:"earth_spirit",108:"abyssal_underlord",109:"terrorblade",110:"phoenix",111:"oracle",112:"winter_wyvern",113:"arc_warden",114:"monkey_king",119:"dark_willow",120:"pangolier",121:"grimstroke",123:"hoodwink",126:"void_spirit",128:"snapfire",129:"mars",135:"dawnbreaker",136:"marci",137:"primal_beast",138:"muerta"};

const GAME_MODE = {
  0: "Unknown", 1: "All Pick", 2: "Captains Mode", 3: "Random Draft", 4: "Single Draft", 5: "All Random",
  16: "Captains Draft", 18: "Ability Draft", 22: "All Draft", 23: "Turbo"
};
const LOBBY_TYPE = { 0:"Normal", 2:"Tournament", 7:"Ranked", 9:"Battle Cup" };

function fmtTime(sec) {
  if (sec == null) return "--:--";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function Hero({ id }) {
  const [err, setErr] = useState(false);
  const name = HERO_MAP[id];
  const src = name
    ? `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${name}.png`
    : null;

  if (!src || err) {
    return (
      <div className="hero-box flex items-center justify-center text-[9px] text-slate-500 bg-slate-950/50">?</div>
    );
  }

  return (
    <div className="hero-box" title={name}>
      <img className="hero-img" src={src} onError={() => setErr(true)} />
    </div>
  );
}

function Pill({ children, className }) {
  return (
    <span
      className={`text-[10px] font-black tracking-wide uppercase bg-slate-950/45 border border-white/10 text-slate-300 px-2 py-1 rounded-full ${className || ""}`}
    >
      {children}
    </span>
  );
}

function CopyBtn({ text, label }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      window.prompt("Copy to clipboard:", text);
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="px-3 py-1.5 text-[11px] font-black rounded-lg border bg-slate-950/40 hover:bg-slate-800/60 border-slate-700 text-slate-200 transition-all active:scale-[0.98]"
    >
      {ok ? "COPIED" : label}
    </button>
  );
}

function CopyWatch({ serverId }) {
  const cmd = serverId ? `watch_server ${serverId}` : "";
  if (!serverId) {
    return (
      <button
        disabled
        className="px-3 py-1.5 text-[11px] font-black rounded-lg border bg-slate-950/20 border-slate-800 text-slate-600 cursor-not-allowed"
      >
        COPY WATCH
      </button>
    );
  }
  return <CopyBtn text={cmd} label="COPY WATCH" />;
}

function BigBetButton({ tone, label, mult, onClick, disabled }) {
  const base =
    "w-full px-4 py-3 rounded-xl font-black uppercase text-xs md:text-sm transition-all active:scale-[0.985] shadow-lg border";
  const tones = {
    green: "bg-green-600 hover:bg-green-500 border-green-300/20 shadow-green-900/25 text-white",
    red: "bg-red-600 hover:bg-red-500 border-red-300/20 shadow-red-900/25 text-white",
    gray: "bg-slate-700 hover:bg-slate-600 border-white/10 shadow-black/20 text-white"
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tones[tone] || tones.gray}${disabled ? " opacity-40 cursor-not-allowed" : ""}`}
    >
      <div className="flex items-center justify-center gap-2">
        <span>{label}</span>
        {mult != null && <span className="opacity-80 font-black">x{mult}</span>}
      </div>
    </button>
  );
}

function GameTimer({ startTimestamp, closeSec }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTimestamp) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTimestamp]);

  const remaining = closeSec - elapsed;
  const open = remaining > 0;

  return (
    <div className="text-right">
      <div className="font-mono text-2xl md:text-3xl font-black tracking-tight">{fmtTime(elapsed)}</div>
      <div
        className={
          "text-[10px] font-black inline-block px-2 py-1 rounded border " +
          (open
            ? "bg-green-900/30 text-green-300 border-green-500/20 animate-pulse"
            : "bg-red-900/30 text-red-300 border-red-500/20")
        }
      >
        {open ? "OPEN - " + fmtTime(remaining) : "LOCKED"}
      </div>
    </div>
  );
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [games, setGames] = useState([]);
  const [bets, setBets] = useState([]);
  const [wallet, setWallet] = useState("");
  const [amt, setAmt] = useState("10");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const m = await (await fetch("/api/meta")).json();
      setMeta(m);
      setGames(await (await fetch("/api/games")).json());
      setBets(await (await fetch("/api/bets")).json());
    } catch (error) {
      return;
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  const connect = async () => {
    if (!window.ethereum) return alert("Please install MetaMask!");
    const p = new ethers.providers.Web3Provider(window.ethereum);
    await p.send("eth_requestAccounts", []);
    const s = p.getSigner();
    setWallet(await s.getAddress());

    if (meta) {
      const n = await p.getNetwork();
      if (n.chainId !== meta.chainId) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: meta.chainIdHex }] });
        } catch (error) {
          alert("Please switch network to Soneium Minato");
        }
      }
    }
  };

  const placeBet = async (matchId, market, pick) => {
    if (!wallet) return alert("Connect wallet first");
    if (!meta) return;

    setLoading(true);
    try {
      const p = new ethers.providers.Web3Provider(window.ethereum);
      const s = p.getSigner();
      const t = new ethers.Contract(meta.token.address, ["function transfer(address,uint256) returns (bool)"], s);
      const val = ethers.utils.parseUnits(String(amt || "0"), meta.token.decimals);

      const tx = await t.transfer(meta.house, val);
      await tx.wait(1);

      const r = await fetch("/api/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, market, pick, wallet, txHash: tx.hash })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Bet failed");

      await load();
    } catch (error) {
      alert(error.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const myBets = useMemo(() => {
    if (!wallet) return [];
    return bets.filter((b) => b.wallet && b.wallet.toLowerCase() === wallet.toLowerCase()).slice().reverse();
  }, [bets, wallet]);

  const poolRate = meta?.pool?.rateEthToDbet;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
      <div className="min-h-screen bg-[url('https://cdn.wallpapersafari.com/26/5/4l8qEy.jpg')] bg-cover bg-fixed bg-center">
        <div className="min-h-screen bg-slate-950/75 backdrop-blur-[2px]">
          <nav className="glass sticky top-0 z-50 px-5 md:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                <span className="font-black italic text-white text-lg">D</span>
              </div>
              <div>
                <div className="text-white font-black text-xl tracking-tight neon">
                  DBET<span className="text-blue-400">.LIVE</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">Soneium Minato Testnet</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden xl:flex items-center gap-3">
                <a
                  className="text-xs font-black text-slate-300 hover:text-white transition-colors"
                  href="https://superbridge.app/soneium-minato"
                  target="_blank"
                  rel="noreferrer"
                >
                  Bridge ETH
                </a>
                <span className="text-slate-600">|</span>
                <a
                  className="text-xs font-black text-blue-300 hover:text-blue-200 transition-colors"
                  href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get Free ETH
                </a>

                {poolRate && (
                  <>
                    <span className="text-slate-600">|</span>
                    <Pill>
                      1 ETH = {poolRate.toLocaleString()} {meta?.token?.symbol}
                    </Pill>
                    <CopyBtn text={meta?.pool?.address} label="COPY POOL" />
                  </>
                )}
              </div>

              <div className="hidden md:flex items-center gap-2 bg-black/35 border border-white/10 rounded-xl px-3 py-2">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bet Amount</div>
                <input
                  type="number"
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  className="w-16 bg-transparent text-right font-black text-white outline-none"
                />
                <div className="text-[10px] font-black text-slate-400">{meta?.token?.symbol || ""}</div>
              </div>

              <button
                onClick={connect}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl font-black text-xs shadow-lg shadow-blue-600/20 transition-all active:scale-[0.985]"
              >
                {wallet ? wallet.slice(0, 6) + "..." + wallet.slice(-4) : "Connect Wallet"}
              </button>
            </div>
          </nav>

          <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-end justify-between border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white neon">Live Matches</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Only games in the first 5 minutes appear here (expiring on top).
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black bg-black/30 px-3 py-1 rounded-full text-slate-200 border border-white/10">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  LIVE FEED
                </div>
              </div>

              {games.length === 0 && (
                <div className="glass rounded-2xl p-10 text-center border border-dashed border-white/15">
                  <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-slate-300 font-mono text-sm">Scanning for matches...</p>
                </div>
              )}

              {games.map((g) => {
                const gm = g.game_mode != null ? GAME_MODE[g.game_mode] || "Mode " + g.game_mode : null;
                const lb = g.lobby_type != null ? LOBBY_TYPE[g.lobby_type] || "Lobby " + g.lobby_type : null;

                return (
                  <div key={g.match_id} className="glass rounded-2xl overflow-hidden border border-white/10 hover:border-blue-400/30 transition-all">
                    <div className="bg-black/30 px-5 py-4 flex items-center justify-between border-b border-white/10">
                      <div className="flex items-center gap-3">
                        <CopyWatch serverId={g.server_steam_id} />
                        <div className="flex flex-wrap gap-2">
                          <Pill>ID: {g.match_id}</Pill>
                          {gm && <Pill>{gm}</Pill>}
                          {lb && <Pill>{lb}</Pill>}
                          {g.average_mmr != null && <Pill>MMR: {g.average_mmr}</Pill>}
                        </div>
                      </div>
                      <GameTimer startTimestamp={g.startTimestamp} closeSec={meta?.closeSeconds || 300} />
                    </div>

                    <div className="p-6">
                      <div className="flex items-center justify-center gap-6 md:gap-10 mb-8">
                        <div className="flex-1 flex flex-col items-end">
                          <div className="flex gap-1 flex-wrap justify-end mb-2">
                            {g.radiant_heroes.map((h, i) => (
                              <Hero key={i} id={h} />
                            ))}
                          </div>
                          <div className="text-5xl md:text-6xl font-black text-green-300 drop-shadow">
                            {g.score_radiant}
                          </div>
                          <div className="text-[10px] font-black tracking-[0.25em] text-green-400 uppercase mt-2">
                            Radiant
                          </div>
                        </div>

                        <div className="text-slate-500 font-black text-3xl italic opacity-60">VS</div>

                        <div className="flex-1 flex flex-col items-start">
                          <div className="flex gap-1 flex-wrap justify-start mb-2">
                            {g.dire_heroes.map((h, i) => (
                              <Hero key={i} id={h} />
                            ))}
                          </div>
                          <div className="text-5xl md:text-6xl font-black text-red-300 drop-shadow">
                            {g.score_dire}
                          </div>
                          <div className="text-[10px] font-black tracking-[0.25em] text-red-400 uppercase mt-2">
                            Dire
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="bg-black/25 border border-white/10 rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest">Primary Market</div>
                              <div className="text-base font-black text-white">
                                {meta?.odds?.MATCH_WINNER?.label || "Match Winner"}
                              </div>
                            </div>
                            <div className="text-[10px] font-black text-slate-400">
                              Transfer {meta?.token?.symbol || ""} to House
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <BigBetButton
                              tone="green"
                              label="Radiant"
                              mult={meta?.odds?.MATCH_WINNER?.Radiant?.display}
                              onClick={() => placeBet(g.match_id, "MATCH_WINNER", "Radiant")}
                              disabled={loading}
                            />
                            <BigBetButton
                              tone="red"
                              label="Dire"
                              mult={meta?.odds?.MATCH_WINNER?.Dire?.display}
                              onClick={() => placeBet(g.match_id, "MATCH_WINNER", "Dire")}
                              disabled={loading}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {Object.keys(meta?.odds || {})
                            .filter((k) => k.includes("KILLS"))
                            .map((mKey) => (
                              <div key={mKey} className="bg-black/25 border border-white/10 rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <div>
                                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Side Market</div>
                                    <div className="text-sm font-black text-white">
                                      {meta.odds[mKey].label || mKey.replaceAll("_", " ")}
                                    </div>
                                  </div>
                                  <Pill>Settles @ {mKey.includes("10") ? "10:00" : "15:00"}</Pill>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                  <BigBetButton
                                    tone="green"
                                    label="Radiant"
                                    mult={meta.odds[mKey].Radiant.display}
                                    onClick={() => placeBet(g.match_id, mKey, "Radiant")}
                                    disabled={loading}
                                  />
                                  <BigBetButton
                                    tone="gray"
                                    label="Draw"
                                    mult={meta.odds[mKey].Draw.display}
                                    onClick={() => placeBet(g.match_id, mKey, "Draw")}
                                    disabled={loading}
                                  />
                                  <BigBetButton
                                    tone="red"
                                    label="Dire"
                                    mult={meta.odds[mKey].Dire.display}
                                    onClick={() => placeBet(g.match_id, mKey, "Dire")}
                                    disabled={loading}
                                  />
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="lg:col-span-4 space-y-6">
              <div className="glass rounded-2xl p-6 sticky top-24 border border-white/10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-black text-white">My Bets</h3>
                  <Pill>{wallet ? "Connected" : "Not connected"}</Pill>
                </div>

                <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-2">
                  {!wallet && (
                    <div className="text-center py-10 text-slate-400 text-sm">
                      Connect wallet to view your bet history.
                    </div>
                  )}

                  {wallet && myBets.length === 0 && (
                    <div className="text-center py-10 text-slate-400 text-sm">No bets yet.</div>
                  )}

                  {wallet &&
                    myBets.map((b) => {
                      const m = b.match;

                      const statusTone =
                        b.status === "WON"
                          ? "bg-green-900/30 text-green-200 border-green-500/20"
                          : b.status === "PENDING"
                            ? "bg-yellow-900/30 text-yellow-200 border-yellow-500/20"
                            : b.status === "VOID"
                              ? "bg-slate-800/60 text-slate-200 border-white/10"
                              : "bg-red-900/30 text-red-200 border-red-500/20";

                      return (
                        <div key={b.id} className="bg-black/25 border border-white/10 rounded-2xl overflow-hidden">
                          <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] font-black text-blue-300 uppercase tracking-widest truncate">
                                {b.market.replaceAll("_", " ")}
                              </div>
                              <div className="text-xs text-slate-300 mt-1 flex flex-wrap gap-2">
                                <Pill>Pick: {b.pick}</Pill>
                                {(() => {
                                  if (b.status === "PENDING" && m?.elapsed != null && meta?.odds?.[b.market]?.timer) {
                                    const target = meta.odds[b.market].timer;
                                    const left = target - m.elapsed;
                                    if (left > 0) return <Pill>Settles in {fmtTime(left)}</Pill>;
                                    return <Pill className="text-yellow-300 animate-pulse">Settling...</Pill>;
                                  }
                                  return m?.elapsed != null && <Pill>T={fmtTime(m.elapsed)}</Pill>;
                                })()}
                                {m?.game_mode != null && <Pill>{GAME_MODE[m.game_mode] || "Mode " + m.game_mode}</Pill>}
                                {m?.lobby_type != null && <Pill>{LOBBY_TYPE[m.lobby_type] || "Lobby " + m.lobby_type}</Pill>}
                              </div>
                            </div>
                            <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${statusTone}`}>
                              {b.status}
                            </span>
                          </div>

                          <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-slate-300">
                                Match: <span className="font-black text-white">{b.matchId}</span>
                              </div>
                              <CopyWatch serverId={m?.server_steam_id} />
                            </div>

                            {m ? (
                              <>
                                <div className="flex items-center justify-center gap-4">
                                  <div className="flex-1">
                                    <div className="flex gap-1 flex-wrap justify-end">
                                      {m.radiant_heroes?.map((h, i) => (
                                        <Hero key={i} id={h} />
                                      ))}
                                    </div>
                                    <div className="text-right text-[10px] font-black tracking-[0.2em] text-green-400 mt-2">
                                      RADIANT
                                    </div>
                                  </div>

                                  <div className="text-center">
                                    <div className="text-2xl font-black">
                                      <span className="text-green-300">{m.score_radiant}</span>
                                      <span className="text-slate-500 mx-2">-</span>
                                      <span className="text-red-300">{m.score_dire}</span>
                                    </div>
                                    <div className="text-[10px] font-mono text-slate-400">
                                      Live score{m.lastSeen && Date.now() - m.lastSeen > 15000 ? " (stale)" : ""}
                                    </div>
                                  </div>

                                  <div className="flex-1">
                                    <div className="flex gap-1 flex-wrap justify-start">
                                      {m.dire_heroes?.map((h, i) => (
                                        <Hero key={i} id={h} />
                                      ))}
                                    </div>
                                    <div className="text-left text-[10px] font-black tracking-[0.2em] text-red-400 mt-2">
                                      DIRE
                                    </div>
                                  </div>
                                </div>

                                {Array.isArray(m.parties) && m.parties.length > 0 && (
                                  <div className="bg-slate-950/40 border border-white/10 rounded-xl p-3">
                                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2">
                                      Party Info
                                    </div>
                                    <div className="space-y-1">
                                      {m.parties.slice(0, 5).map((p) => (
                                        <div key={p.party_id} className="flex items-center justify-between text-xs text-slate-300">
                                          <span className="font-mono text-[11px]">party_id: {p.party_id}</span>
                                          <span className="font-black">
                                            size {p.count} - <span className="text-green-300">{p.radiant}R</span> /{" "}
                                            <span className="text-red-300">{p.dire}D</span>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-sm text-slate-400 bg-slate-950/30 border border-white/10 rounded-xl p-4 text-center">
                                Match context not available (signal lost). Bet remains tracked.
                              </div>
                            )}

                            {b.resultInfo && (
                              <div className="text-center text-xs font-mono text-slate-300 bg-slate-950/35 border border-white/10 rounded-xl p-3">
                                Result Snapshot: <span className="font-black text-white">{b.resultInfo}</span>
                              </div>
                            )}

                            {b.payoutTx && (
                              <div className="text-[11px] text-slate-400 bg-slate-950/35 border border-white/10 rounded-xl p-3">
                                Payout Tx: <span className="font-mono break-all">{b.payoutTx}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>

                <div className="mt-6 text-[11px] text-slate-500">
                  Games vanish from <span className="text-slate-300 font-black">Live Matches</span> exactly at 5:00,
                  but your bet cards keep updating as long as OpenDota still reports the match.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
