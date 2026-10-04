// zod schemas for the Warcon answers the site reads. Each names only what a page shows:
// zod drops everything else, so private fields (pings, notes, watchlist, risk, bans, IPs,
// RCON hosts) never leave this module. Never make these schemas loose.
import { z } from 'zod';

const steamId = z.string().regex(/^\d{17}$/);
const iso = z.string();

export const serversBody = z.object({
  ok: z.literal(true),
  servers: z.array(z.object({ id: z.string(), orgId: z.string(), name: z.string(), sortOrder: z.number() })),
});
export type WServer = z.infer<typeof serversBody>['servers'][number];

const player = z.object({
  name: z.string(),
  steamId: z.string(),
  faction: z.string().nullable(),
  kills: z.number(),
  deaths: z.number(),
  cash: z.number(),
});
export type WPlayer = z.infer<typeof player>;

const live = z.object({
  ok: z.boolean(),
  gameServerId: z.string(),
  startedAt: iso.nullable(),
  observedAt: iso.nullable(),
  status: z
    .object({
      serverName: z.string(),
      map: z.string(),
      experiences: z.array(z.string()),
      lighting: z.string(),
      matchSeconds: z.number().nullable(),
      playerCount: z.number(),
      maxPlayers: z.number(),
      scores: z.array(z.object({ name: z.string(), colorHex: z.string(), score: z.number() })),
    })
    .nullable(),
  players: z.array(player),
});
export const liveBody = z.object({ live: live.nullable() });
export type WLive = z.infer<typeof live>;

const boardRow = z.object({
  rank: z.number(),
  steamId: z.string(),
  name: z.string(),
  minutes: z.number(),
  kills: z.number(),
  deaths: z.number(),
  headshots: z.number(),
  matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  cash: z.number(),
  lastSeen: iso.nullable(),
});
export const boardBody = z.object({ ok: z.literal(true), rows: z.array(boardRow), total: z.number(), pageSize: z.number() });
export type WBoardRow = z.infer<typeof boardRow>;
export type WBoard = z.infer<typeof boardBody>;

const result = z.enum(['win', 'loss', 'draw']).nullable();
const careerGroup = z.object({ key: z.string(), matches: z.number(), wins: z.number(), losses: z.number(), draws: z.number(), kills: z.number(), deaths: z.number() });
const careerMatch = z.object({
  matchId: z.number(),
  serverId: z.string(),
  serverName: z.string(),
  startedAt: iso,
  endedAt: iso.nullable(),
  map: z.string().nullable(),
  faction: z.string().nullable(),
  result,
  seconds: z.number(),
  kills: z.number(),
  deaths: z.number(),
  cashDelta: z.number(),
  headshots: z.number(),
});
export const careerBody = z.object({
  ok: z.literal(true),
  career: z.object({
    rank: z.object({ server: z.number().nullable(), org: z.number().nullable() }),
    streak: z.object({ kind: z.enum(['win', 'loss']), n: z.number() }).nullable(),
    matches: z.number(),
    wins: z.number(),
    losses: z.number(),
    draws: z.number(),
    kills: z.number(),
    deaths: z.number(),
    minutes: z.number(),
    headshots: z.number(),
    longestM: z.number().nullable(),
    killStreak: z.number(),
    maps: z.array(careerGroup),
    factions: z.array(careerGroup),
    last: z.array(careerMatch),
  }),
});
export type WCareer = z.infer<typeof careerBody>['career'];
export type WCareerMatch = z.infer<typeof careerMatch>;

const kill = z.object({
  eventId: z.string(),
  ts: iso,
  map: z.string(),
  eventTime: z.number(),
  killer: z.object({ steamId: z.string(), name: z.string(), faction: z.string().nullable() }).nullable(),
  victim: z.object({ steamId: z.string(), name: z.string(), faction: z.string().nullable() }),
  cause: z.string().nullable(),
  distanceM: z.number().nullable(),
  headshot: z.boolean(),
  suicide: z.boolean(),
  teamKill: z.boolean(),
  tags: z.array(z.string()),
});
export type WKill = z.infer<typeof kill>;
export const killsBody = z.object({ ok: z.literal(true), kills: z.array(kill), total: z.number().nullable() });
export type WKills = z.infer<typeof killsBody>;

const combat = z.object({
  kills: z.number(),
  deaths: z.number(),
  headshots: z.number(),
  teamKills: z.number(),
  suicides: z.number(),
  avgDistanceM: z.number().nullable(),
  longestM: z.number().nullable(),
  causes: z.array(z.object({ cause: z.string(), kills: z.number() })),
  victims: z.array(z.object({ steamId: z.string(), name: z.string(), kills: z.number() })),
  nemeses: z.array(z.object({ steamId: z.string(), name: z.string(), deaths: z.number() })),
  recent: z.array(kill.extend({ serverId: z.string(), serverName: z.string() })),
});
export type WCombat = z.infer<typeof combat>;
export const dossierBody = z.object({
  ok: z.literal(true),
  dossier: z.object({
    steamId,
    name: z.string(),
    names: z.array(z.string()),
    online: z.object({ serverId: z.string(), serverName: z.string() }).nullable(),
    steam: z.object({ avatar: z.string() }).nullable(),
    summary: z.object({
      sessions: z.number(),
      minutes: z.number(),
      kills: z.number(),
      deaths: z.number(),
      firstSeen: iso.nullable(),
      lastSeen: iso.nullable(),
    }),
    combat: combat.nullable(),
    perServer: z.array(
      z.object({ serverId: z.string(), serverName: z.string(), minutes: z.number(), kills: z.number(), deaths: z.number(), lastSeen: iso }),
    ),
  }),
});
export type WDossier = z.infer<typeof dossierBody>['dossier'];

const matchSummary = z.object({
  id: z.number(),
  startedAt: iso,
  endedAt: iso.nullable(),
  map: z.string().nullable(),
  experiences: z.string().nullable(),
  lighting: z.string().nullable(),
  peakPlayers: z.number(),
  players: z.number(),
  finalScores: z.array(z.object({ name: z.string(), score: z.number() })).nullable(),
  winner: z.string().nullable(),
});
export type WMatchSummary = z.infer<typeof matchSummary>;
const liveFaction = z.object({ name: z.string(), colorHex: z.string().nullable(), score: z.number() });
export const matchListBody = z.object({
  ok: z.literal(true),
  matches: z.array(matchSummary),
  live: z.array(liveFaction),
  page: z.number(),
  pages: z.number(),
  total: z.number(),
});
export type WMatchList = z.infer<typeof matchListBody>;

const matchLine = z.object({
  steamId: z.string(),
  name: z.string(),
  faction: z.string().nullable(),
  seconds: z.number(),
  kills: z.number(),
  deaths: z.number(),
  cashDelta: z.number(),
  headshots: z.number(),
  longestM: z.number().nullable(),
  killStreak: z.number(),
  result,
});
export type WMatchLine = z.infer<typeof matchLine>;
export const matchBody = z.object({
  ok: z.literal(true),
  match: matchSummary,
  factions: z.array(z.object({ name: z.string(), colorHex: z.string().nullable() })),
  lines: z.array(matchLine),
  timeline: z.array(z.array(z.number())),
  awards: z.array(z.object({ key: z.string(), label: z.string(), steamId: z.string(), name: z.string(), value: z.string() })),
  kills: z.number(),
  hasFeed: z.boolean(),
});
export type WMatchView = Omit<z.infer<typeof matchBody>, 'ok'>;

export const analyticsBody = z.object({
  ok: z.literal(true),
  bucketSeconds: z.number(),
  summary: z.object({ uniquePlayers: z.number(), peakPlayers: z.number(), avgPlayers: z.number(), onlineNow: z.number(), matches: z.number() }),
  population: z.array(z.object({ ts: iso, avg: z.number().nullable(), max: z.number().nullable(), cap: z.number().nullable() })),
  maps: z.array(z.object({ map: z.string(), minutes: z.number(), matches: z.number() })),
  wins: z.object({ teams: z.array(z.object({ name: z.string(), wins: z.number(), colorHex: z.string().nullable() })) }),
  combat: z.object({ kills: z.number(), headshots: z.number() }).nullable(),
});
export type WAnalytics = z.infer<typeof analyticsBody>;

const seenPlayer = z.object({
  steamId: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  firstSeen: iso,
  lastSeen: iso,
  minutes: z.number(),
  kills: z.number(),
  deaths: z.number(),
  online: z.boolean(),
  lastServerId: z.string(),
  steam: z.object({ avatar: z.string() }).nullable(),
});
export const seenBody = z.object({ ok: z.literal(true), players: z.array(seenPlayer), total: z.number() });
export type WSeenPlayer = z.infer<typeof seenPlayer>;

export const steamProfilesBody = z.record(z.string(), z.object({ name: z.string(), avatar: z.string() }).nullable());
export type WSteamProfiles = z.infer<typeof steamProfilesBody>;
