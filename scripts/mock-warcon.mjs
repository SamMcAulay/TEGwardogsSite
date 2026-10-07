// A fake Warcon for local development: the endpoints the site reads, with the same shapes,
// from data generated off a fixed seed. Kills keep arriving while it runs.
//   node scripts/mock-warcon.mjs        listens on 127.0.0.1:4100, token "mock-token"
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4100);
const TOKEN = process.env.MOCK_TOKEN ?? 'mock-token';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FACTIONS = [
  { name: 'Valkyra', colorHex: '#d4483b' },
  { name: 'Lonestar', colorHex: '#3b7bd4' },
];
const MAPS = ['Brimstone', 'Harbour', 'Pinewood', 'Quarry'];
const CAUSES = ['Id.Item.AK74M', 'Id.Item.M4A1', 'Id.Item.SVD', 'Id.Item.Glock17', 'Id.Vehicle.Humvee'];
const SERVERS = ['EU#1', 'EU#2', 'NA#1', 'NA#2', 'NA#3', 'OC#1'].map((short, i) => ({
  id: `srv-${i + 1}`,
  orgId: 'org-1',
  name: `${short} - Sealclubbing = ban - TEG.gg - ENGLISH`,
  sortOrder: i,
  host: '10.0.0.1', // private: must never reach a page
  notes: 'rcon pw in vault',
}));
const PLAYERS = Array.from({ length: 300 }, (_, i) => ({
  steamId: String(76561198000000000n + BigInt(i + 1)),
  name: `${pick(['Night', 'Iron', 'Red', 'Silent', 'Owl', 'Rook', 'Viper'])}${pick(['Owl', 'Fox', 'Bear', 'Hawk', 'Wolf'])}${i}`,
}));

const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();

const matches = new Map(); // serverId -> MatchSummary[] newest first
const lines = new Map(); // `${serverId}:${matchId}` -> MatchLine[]
const kills = new Map(); // serverId -> KillView[] newest first
for (const s of SERVERS) {
  const list = [];
  for (let m = 40; m >= 1; m--) {
    const start = now() - m * 3_600_000;
    const ended = m > 1;
    const scores = FACTIONS.map((f) => ({ name: f.name, score: int(0, 500) }));
    list.unshift({
      id: m, startedAt: iso(start), endedAt: ended ? iso(start + 3_000_000) : null, map: pick(MAPS),
      experiences: 'King of the Hill', lighting: pick(['Day', 'Night']), peakPlayers: int(10, 64), players: 20,
      finalScores: ended ? scores : null, winner: ended ? scores.sort((a, b) => b.score - a.score)[0].name : null,
    });
    lines.set(`${s.id}:${m}`, Array.from({ length: 20 }, () => {
      const p = pick(PLAYERS);
      return { steamId: p.steamId, name: p.name, faction: pick(FACTIONS).name, seconds: int(600, 3000), kills: int(0, 40), deaths: int(0, 30), cashDelta: int(-500, 3000), headshots: int(0, 10), teamKills: 0, suicides: 0, vehicleKills: 0, longestM: int(5, 400), killStreak: int(0, 12), deathStreak: 0, result: pick(['win', 'loss']) };
    }));
  }
  matches.set(s.id, list);
  kills.set(s.id, Array.from({ length: 200 }, (_, k) => makeKill(now() - k * 20_000)));
}
function makeKill(at) {
  const killer = pick(PLAYERS);
  const victim = pick(PLAYERS);
  return {
    eventId: `k${at}${int(0, 9999)}`, ts: iso(at), map: pick(MAPS), eventTime: int(0, 3000),
    killer: { steamId: killer.steamId, name: killer.name, faction: pick(FACTIONS).name },
    victim: { steamId: victim.steamId, name: victim.name, faction: pick(FACTIONS).name },
    cause: pick(CAUSES), distanceM: int(1, 450), headshot: rand() < 0.2, suicide: false, teamKill: rand() < 0.03, tags: [],
  };
}
setInterval(() => {
  for (const s of SERVERS) kills.get(s.id).unshift(makeKill(now()));
}, 2000).unref();

function board(params) {
  const rows = PLAYERS.map((p, i) => ({
    rank: 0, steamId: p.steamId, name: p.name, minutes: 60 + ((i * 37) % 3000), seedMinutes: 0, kills: (i * 13) % 900, deaths: (i * 7) % 600 + 1,
    headshots: (i * 3) % 200, teamKills: 0, suicides: 0, vehicleKills: 0, killStreak: 5, deathStreak: 3, matches: 1 + (i % 80), wins: i % 40, losses: i % 30, draws: 0, cash: i * 100, lastSeen: iso(now() - i * 60_000),
  }));
  const sort = params.get('sort') ?? 'kills';
  const key = { perHour: (r) => r.kills / r.minutes, kd: (r) => r.kills / r.deaths, playtime: (r) => r.minutes, winRate: (r) => r.wins / (r.wins + r.losses || 1) }[sort] ?? ((r) => r[sort] ?? r.kills);
  rows.sort((a, b) => key(b) - key(a)).forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// The three best killers are on the org ban list, so the boards visibly skip them in development;
// one more player is banned on a single server only, which the site must ignore.
const ORG_BANNED = board(new URLSearchParams('sort=kills')).slice(0, 3).map((r) => r.steamId);
const SERVER_BANNED = [PLAYERS[PLAYERS.length - 1].steamId];
// Watched: two ordinary players, plus one who is also org-banned (the site must leave them off).
function watchedList(id) {
  const players = [PLAYERS[5], PLAYERS[9], { ...PLAYERS[0], steamId: ORG_BANNED[0] }].map((p, i) => ({
    ...p, aliases: [], firstSeen: iso(now() - 86_400_000), lastSeen: iso(now() - i * 3_600_000), minutes: 120, kills: 10, deaths: 8,
    online: false, lastServerId: id, lastServerName: id, banned: i === 2 ? 'org' : null, watched: true, reason: 'mock reason', steam: null,
  }));
  return { ok: true, players, total: players.length };
}

function bannedList(q) {
  const all = [...ORG_BANNED.map((steamId) => ({ steamId, banned: 'org' })), ...SERVER_BANNED.map((steamId) => ({ steamId, banned: 'server' }))]
    .map((b) => ({ ...b, name: PLAYERS.find((p) => p.steamId === b.steamId).name, aliases: [], firstSeen: iso(now()), lastSeen: iso(now()), minutes: 60, kills: 1, deaths: 1, online: false, lastServerId: 'srv-1', watched: false, steam: null }));
  const offset = Number(q.get('offset') ?? 0);
  return { ok: true, total: all.length, players: all.slice(offset, offset + Number(q.get('limit') ?? 50)) };
}

const routes = [
  [/^\/api\/servers$/, () => ({ ok: true, servers: SERVERS })],
  [/^\/api\/servers\/([^/]+)\/summary$/, (_, id) => {
    const s = SERVERS.find((x) => x.id === id);
    if (id === 'srv-6') return { ok: false, live: null, error: { message: 'Not observed yet.' } }; // an offline server
    const players = PLAYERS.slice(0, 24).map((p) => ({ ...p, faction: pick(FACTIONS).name, kills: int(0, 20), deaths: int(0, 15), cash: int(0, 5000), ping: int(20, 140) }));
    return { ok: true, live: { serverId: id, ok: true, error: '', tier: 'hot', build: '1.0.0', gameServerId: `JOIN-${id}`, startedAt: iso(now() - 7_200_000), reservedSlots: 2, throttledUntil: null,
      status: { serverName: s.name, map: pick(MAPS), experiences: ['King of the Hill'], lighting: 'Day', alternator: '', scoreTick: null, scoreTickMin: null, scoreTickMax: null, scoreCap: 500, matchSeconds: 900, playerCount: players.length, maxPlayers: 64, scores: FACTIONS.map((f) => ({ ...f, score: int(0, 300) })), rotationNow: 0, rotationNext: 1 },
      players, statusAt: iso(now()), playersAt: iso(now()), observedAt: iso(now()) } };
  }],
  [/^\/api\/servers\/([^/]+)\/leaderboard$/, (q) => {
    const rows = board(q);
    const page = Number(q.get('page') ?? 1);
    return { ok: true, rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, pageSize: 50, hasFeed: true };
  }],
  [/^\/api\/servers\/([^/]+)\/leaderboard\/export$/, (q) => {
    const head = 'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen';
    return { csv: [head, ...board(q).map((r) => `${r.rank},${r.steamId},"${r.name}",${r.minutes},0,${r.kills},${r.deaths},0,0,0,0,0,0,0,0,${r.matches},${r.wins},${r.losses},0,0,${r.cash},${r.lastSeen}`)].join('\n') };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/(\d{17})\/career$/, (_, id, steamId) => {
    if (!PLAYERS.some((p) => p.steamId === steamId)) return { ok: true, career: { rank: { server: null, org: null, floorMinutes: 60 }, streak: null, matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, minutes: 0, headshots: 0, vehicleKills: 0, longestM: null, killStreak: 0, deathStreak: 0, maps: [], factions: [], last: [] } };
    const last = matches.get(id).slice(1, 11).map((m) => ({ matchId: m.id, serverId: id, serverName: SERVERS.find((s) => s.id === id).name, startedAt: m.startedAt, endedAt: m.endedAt, map: m.map, faction: 'Valkyra', result: pick(['win', 'loss']), seconds: 1800, kills: int(0, 30), deaths: int(0, 20), cashDelta: 500, headshots: 2, killStreak: 4 }));
    return { ok: true, career: { rank: { server: 12, org: 30, floorMinutes: 60 }, streak: { kind: 'win', n: 2 }, matches: 80, wins: 45, losses: 35, draws: 0, kills: 1200, deaths: 800, minutes: 4000, headshots: 200, vehicleKills: 5, longestM: 412, killStreak: 15, deathStreak: 6,
      maps: MAPS.map((key) => ({ key, matches: 20, wins: 11, losses: 9, draws: 0, kills: 300, deaths: 200 })), factions: FACTIONS.map((f) => ({ key: f.name, matches: 40, wins: 22, losses: 18, draws: 0, kills: 600, deaths: 400 })), last } };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/(\d{17})$/, (_, id, steamId) => {
    const p = PLAYERS.find((x) => x.steamId === steamId);
    const recent = kills.get(id).slice(0, 10).map((k) => ({ ...k, serverId: id, serverName: SERVERS.find((s) => s.id === id).name }));
    return { ok: true, dossier: {
      steamId, name: p?.name ?? steamId, names: p ? [p.name, `${p.name}_old`] : [], online: null, steamEnabled: true,
      steam: p ? { persona: p.name, avatar: '', profileUrl: '', public: true, vacBans: 1 } : null,
      risk: { level: 'high' }, watch: { watched: true, reason: 'PRIVATE-WATCH-REASON', updatedByName: 'mod', updatedAt: null },
      bannedOn: [], orgServerCount: 6, orgLists: { ban: null, reserve: null, canBan: false, canReserve: false },
      summary: p ? { sessions: 40, minutes: 4000, kills: 1200, deaths: 800, firstSeen: iso(now() - 30 * 86_400_000), lastSeen: iso(now()) } : { sessions: 0, minutes: 0, kills: 0, deaths: 0, firstSeen: null, lastSeen: null },
      combat: p ? { kills: 1200, deaths: 800, headshots: 200, teamKills: 3, teamKilled: 2, suicides: 1, avgDistanceM: 60, longestM: 412,
        causes: CAUSES.map((cause, i) => ({ cause, kills: 300 - i * 50 })), victims: PLAYERS.slice(0, 5).map((v) => ({ ...v, kills: 9 })), nemeses: PLAYERS.slice(5, 10).map((v) => ({ ...v, deaths: 7 })), recent } : null,
      perServer: p ? SERVERS.slice(0, 3).map((s) => ({ serverId: s.id, serverName: s.name, sessions: 10, minutes: 1000, kills: 300, deaths: 200, lastSeen: iso(now()) })) : [],
      recent: [], notes: [{ body: 'PRIVATE-NOTE' }], actions: [] } };
  }],
  [/^\/api\/servers\/([^/]+)\/matches$/, (q, id) => {
    const all = matches.get(id);
    const page = Number(q.get('page') ?? 1);
    return { ok: true, matches: all.slice((page - 1) * 50, page * 50), live: FACTIONS.map((f) => ({ ...f, score: 0 })), page, pageSize: 50, total: all.length, pages: Math.ceil(all.length / 50) };
  }],
  [/^\/api\/servers\/([^/]+)\/matches\/(\d+)$/, (_, id, matchId) => {
    const m = matches.get(id).find((x) => x.id === Number(matchId));
    if (!m || !m.endedAt) return null;
    const l = lines.get(`${id}:${m.id}`);
    return { ok: true, match: m, factions: FACTIONS, lines: l, timeline: Array.from({ length: 30 }, (_, i) => [i * 100, i * 10, i * 9]),
      awards: [{ key: 'kills', label: 'Most kills', steamId: l[0].steamId, name: l[0].name, value: String(l[0].kills) }], kills: 200, hasFeed: true };
  }],
  [/^\/api\/servers\/([^/]+)\/kills$/, (q, id) => {
    let list = kills.get(id);
    for (const f of ['killer', 'victim', 'player']) {
      const v = q.get(f);
      if (v) list = list.filter((k) => (f !== 'victim' && k.killer?.steamId === v) || (f !== 'killer' && k.victim.steamId === v));
    }
    if (q.get('kind') === 'headshot') list = list.filter((k) => k.headshot);
    if (q.get('kind') === 'teamKill') list = list.filter((k) => k.teamKill);
    if (q.get('before')) list = list.filter((k) => k.ts < q.get('before'));
    return { ok: true, configured: true, feedAt: iso(now()), kills: list.slice(0, Number(q.get('limit') ?? 50)), total: q.get('count') === '1' ? list.length : null };
  }],
  [/^\/api\/servers\/([^/]+)\/analytics$/, (q) => {
    const hours = q.get('range') === '7d' ? 168 : q.get('range') === '30d' ? 720 : 24;
    const bucket = hours > 24 ? 3600 * 6 : 600;
    const n = Math.floor((hours * 3600) / bucket);
    return { ok: true, range: q.get('range') ?? '24h', from: iso(now() - hours * 3_600_000), to: iso(now()), sampleSeconds: 60, bucketSeconds: bucket,
      summary: { uniquePlayers: 120, peakPlayers: 60, avgPlayers: 30, uptimePct: 99, onlineNow: 24, samples: 1000, matches: 20, coveredHours: hours },
      population: Array.from({ length: n }, (_, i) => ({ ts: iso(now() - (n - i) * bucket * 1000), avg: 20 + 15 * Math.sin(i / 6), max: 50, cap: 64, ok: 1, total: 1, up: bucket, down: 0 })),
      cash: [], maps: MAPS.map((map) => ({ map, minutes: 600, matches: 5 })), wins: { teams: FACTIONS.map((f, i) => ({ ...f, wins: 10 - i * 3 })), decided: 17, draws: 0, noResult: 1 },
      players: [], matches: [], hourly: [], combat: { kills: 4000, headshots: 800, teamKills: 20, suicides: 5, vehicleKills: 30, perBucket: [], causes: [], players: [], longest: [] } };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/seen$/, (q, id) => q.get('flag') === 'banned' ? bannedList(q) : q.get('flag') === 'watched' ? watchedList(id) : ({
    ok: true, total: PLAYERS.length,
    players: PLAYERS.slice(0, Number(q.get('limit') ?? 30)).map((p, i) => ({ ...p, aliases: [], firstSeen: iso(now() - 86_400_000), lastSeen: iso(now() - i * 90_000), sessions: 3, minutes: 300, kills: 40, deaths: 30, servers: 1, online: i < 5, lastServerId: id, lastServerName: id, banned: null, watched: i === 0, steam: null })),
  })],
  [/^\/api\/steam\/profiles$/, () => ({})],
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"ok":false,"error":{"message":"bad key"}}');
      return;
    }
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      const body = handler(url.searchParams, ...m.slice(1).map(decodeURIComponent));
      if (body === null) break;
      if (body.csv !== undefined) res.writeHead(200, { 'content-type': 'text/csv' }).end(body.csv);
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"ok":false,"error":{"code":"not_found"}}');
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock Warcon on http://127.0.0.1:${PORT} (token ${TOKEN})`));
