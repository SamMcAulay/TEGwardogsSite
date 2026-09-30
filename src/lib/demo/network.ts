// Simulated WARDOGS servers for demo mode. Each server runs King of the Hill rounds with players
// who come and go on a daily curve, fight, and produce kill feed events shaped like the real feed.

import type { ServerConfig } from '../server/config';
import type { FeedEvent } from '../server/recorder';
import type { GameSource, LivePlayer, ServerStatus } from '../server/rcon';
import {
  CLASS_PROFILE,
  EXPLOSIVES,
  VEHICLES,
  buildPlayers,
  gaussian,
  pick,
  poisson,
  rng,
  weighted,
  type DemoPlayer,
  type Rng,
  type Weapon,
} from './world';

const FACTIONS = [
  { name: 'Valkyra', colorHex: '#D86060' },
  { name: 'Lonestar', colorHex: '#5B95D8' },
  { name: 'Manticore', colorHex: '#7BC462' },
];
const ROTATION = [
  { map: 'Kavkazi', lighting: 'DayClear' },
  { map: 'Europe', lighting: 'DayEarlyFog' },
  { map: 'NorthAmerica', lighting: 'DayLateClear' },
  { map: 'Kavkazi', lighting: 'DayLateGray' },
  { map: 'Europe', lighting: 'DayClear' },
  { map: 'NorthAmerica', lighting: 'DayStartClear' },
];
/** Hour (UTC) each region's evening peaks. */
const PEAK_UTC: Record<string, number> = { NA: 1, EU: 19.5, OCE: 10, ASIA: 13, SA: 0 };
/** Kills per player-minute. The real game runs hotter; this keeps the demo database small. */
const KILL_RATE = 0.13;
const MAX_PLAYERS = 100;

interface Seat {
  player: DemoPlayer;
  faction: string;
  kills: number;
  deaths: number;
  cash: number;
  ping: number;
  leavesAt: number;
}

class DemoServer {
  readonly seats = new Map<string, Seat>();
  scores = [0, 0, 0];
  rates = [0.8, 0.8, 0.8];
  rotationIndex: number;
  matchStart: number;
  matchId = crypto.randomUUID();
  bootAt: number;
  events: FeedEvent[] = [];
  lastAdvance: number;

  constructor(
    readonly cfg: ServerConfig,
    /** 0..1: how busy this server is relative to the region's flagship. */
    readonly draw: number,
    readonly r: Rng,
    now: number,
  ) {
    this.rotationIndex = Math.floor(r() * ROTATION.length);
    this.matchStart = now - Math.floor(r() * 1800);
    this.bootAt = now - Math.floor(r() * 20 * 3600);
    this.lastAdvance = now;
    this.scores = this.scores.map(() => Math.floor(r() * 40));
  }

  status(now: number): ServerStatus {
    const rot = ROTATION[this.rotationIndex];
    return {
      serverName: this.cfg.name,
      map: rot.map,
      experiences: [`${rot.map}_KOTH_01`],
      lighting: rot.lighting,
      scoreTick: { current: 24, min: 18, max: 30 },
      players: { current: this.seats.size, max: MAX_PLAYERS - 2 },
      factionScores: FACTIONS.map((f, i) => ({ ...f, score: Math.floor(this.scores[i]) })),
      rotation: { nowIndex: this.rotationIndex, nextIndex: (this.rotationIndex + 1) % ROTATION.length },
      matchSeconds: now - this.matchStart,
    };
  }

  players(): LivePlayer[] {
    return [...this.seats.values()].map((s) => ({
      name: s.player.name,
      steamId: s.player.steamId,
      faction: s.faction,
      kills: s.kills,
      deaths: s.deaths,
      cash: s.cash,
      pingMs: s.ping,
    }));
  }
}

export class DemoNetwork {
  private readonly servers = new Map<string, DemoServer>();
  private readonly pool: DemoPlayer[];
  private readonly online = new Set<string>();
  private readonly r: Rng;

  constructor(configs: ServerConfig[], now: number, seed = 42) {
    this.r = rng(seed);
    this.pool = buildPlayers(2400);
    const flagshipSeen = new Set<string>();
    for (const cfg of configs) {
      // The first server in each region is the busy one; later ones fill up less.
      const draw = flagshipSeen.has(cfg.region) ? 0.45 + this.r() * 0.3 : 1;
      flagshipSeen.add(cfg.region);
      const server = new DemoServer(cfg, draw, rng(seed + cfg.id.length * 7919 + cfg.id.charCodeAt(0)), now);
      this.servers.set(cfg.id, server);
      // Start mid-evening rather than empty.
      const target = this.targetPopulation(server, now);
      for (let i = 0; i < target; i++) this.seat(server, now);
    }
  }

  get players(): readonly DemoPlayer[] {
    return this.pool;
  }

  /** Target population for a server at a moment: evening peaks, quiet mornings, busier weekends. */
  targetPopulation(server: DemoServer, now: number): number {
    const d = new Date(now * 1000);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    let diff = Math.abs(hour - (PEAK_UTC[server.cfg.region] ?? 19));
    diff = Math.min(diff, 24 - diff);
    const curve = Math.exp(-(diff * diff) / (2 * 3.6 * 3.6));
    const weekend = [0, 6].includes(d.getUTCDay()) ? 1.12 : 1;
    const base = 0.06 + 0.94 * curve;
    return Math.min(MAX_PLAYERS - 2, Math.round((MAX_PLAYERS - 2) * base * weekend * server.draw * 1.05));
  }

  /** Move a server's world forward to `now`. */
  advance(id: string, now: number): void {
    const s = this.servers.get(id);
    if (!s) return;
    const dt = now - s.lastAdvance;
    if (dt <= 0) return;
    s.lastAdvance = now;
    const r = s.r;

    // Round progress: points trickle to whoever holds the zone.
    if (r() < dt / 300) s.rates = s.rates.map(() => 0.3 + r() * 1.6);
    const pop = s.seats.size;
    if (pop >= 4) {
      s.scores = s.scores.map((v, i) => Math.min(100, v + (dt / 60) * s.rates[i] * (0.6 + pop / 70)));
    }
    if (Math.max(...s.scores) >= 100) this.nextRound(s, now);

    // Departures and arrivals.
    for (const [steamId, seat] of s.seats) {
      if (seat.leavesAt <= now) {
        s.seats.delete(steamId);
        this.online.delete(steamId);
      }
    }
    const target = this.targetPopulation(s, now) + Math.round(gaussian(r) * 2);
    const joins = Math.min(Math.max(0, target - s.seats.size), Math.ceil(dt / 12) + 2);
    for (let i = 0; i < joins; i++) this.seat(s, now);

    // Fighting.
    const kills = poisson(r, KILL_RATE * pop * (dt / 60));
    for (let i = 0; i < kills; i++) this.fight(s, now);
    for (const seat of s.seats.values()) {
      seat.cash += Math.round((dt / 60) * (40 + r() * 60));
      seat.ping = Math.max(8, Math.round(seat.ping + gaussian(r) * 2));
    }
  }

  private nextRound(s: DemoServer, now: number) {
    s.rotationIndex = (s.rotationIndex + 1) % ROTATION.length;
    s.scores = [0, 0, 0];
    s.matchStart = now;
    for (const seat of s.seats.values()) {
      seat.kills = 0;
      seat.deaths = 0;
      seat.cash = 800;
    }
  }

  private seat(s: DemoServer, now: number) {
    const r = this.r;
    const candidate = weighted(
      r,
      Array.from({ length: 24 }, () => pick(r, this.pool)),
      (p) => (this.online.has(p.steamId) ? 0 : p.activity * (p.region === s.cfg.region ? 1 : 0.04)),
    );
    if (this.online.has(candidate.steamId)) return;
    const counts = FACTIONS.map((f) => [...s.seats.values()].filter((x) => x.faction === f.name).length);
    const faction = FACTIONS[counts.indexOf(Math.min(...counts))].name;
    this.online.add(candidate.steamId);
    s.seats.set(candidate.steamId, {
      player: candidate,
      faction,
      kills: 0,
      deaths: 0,
      cash: 800,
      ping: s.cfg.region === candidate.region ? 18 + Math.floor(r() * 45) : 140 + Math.floor(r() * 90),
      leavesAt: now + Math.round(900 + Math.pow(r(), 1.4) * 3 * 3600),
    });
  }

  private fight(s: DemoServer, now: number) {
    const r = s.r;
    const seats = [...s.seats.values()];
    if (seats.length < 2) return;
    const victim = pick(r, seats);
    const roll = r();

    let killer: Seat | null = null;
    let weapon: Weapon | null = null;
    let tags: string[] = [];
    let distance: number | undefined;

    if (roll < 0.018) {
      tags = ['Falling'];
    } else if (roll < 0.03) {
      killer = victim;
      weapon = weighted(r, EXPLOSIVES.slice(0, 3), (w) => w.weight);
      tags = ['Suicide'];
    } else {
      const enemies = seats.filter((x) => x.faction !== victim.faction);
      const pool = roll < 0.037 ? seats.filter((x) => x !== victim && x.faction === victim.faction) : enemies;
      if (!pool.length) return;
      killer = weighted(r, pool, (x) => Math.pow(x.player.skill, 1.7));
      const w = r();
      weapon =
        w < killer.player.vehicleBias
          ? weighted(r, VEHICLES, (x) => x.weight)
          : w < killer.player.vehicleBias + 0.08
            ? weighted(r, EXPLOSIVES, (x) => x.weight)
            : w < killer.player.vehicleBias + 0.16
              ? killer.player.sidearm
              : killer.player.primary;
      const profile = CLASS_PROFILE[weapon.cls];
      distance = (profile.min + Math.pow(r(), 1.8) * (profile.max - profile.min)) * 100;
      if (r() < profile.hs * Math.min(1.6, 0.6 + killer.player.skill * 0.4)) tags.push('Headshot');
      if (weapon.cls === 'vehicle' && r() < 0.1) tags.push('VehicleExplosion');
      if (weapon.cls === 'melee') tags.push('WeaponMelee');
      if (weapon.cls === 'rifle' && r() < 0.03) tags.push('Penetration');
    }

    victim.deaths++;
    victim.cash = Math.max(0, victim.cash - 150);
    if (killer && killer !== victim) {
      killer.kills++;
      killer.cash += 100 + (tags.includes('Headshot') ? 50 : 0);
    }
    const rot = ROTATION[s.rotationIndex];
    s.events.push({
      eventId: crypto.randomUUID(),
      type: 'killed',
      eventTime: now - s.matchStart,
      matchId: s.matchId,
      mapName: rot.map,
      ...(killer
        ? { killerName: killer.player.name, killerSteamId: killer.player.steamId, killerId: killer.player.steamId }
        : {}),
      victimName: victim.player.name,
      victimSteamId: victim.player.steamId,
      victimId: victim.player.steamId,
      ...(weapon ? { cause: weapon.cause } : {}),
      ...(distance != null ? { distance } : {}),
      contextTags: [
        ...tags.map((t) =>
          t === 'Suicide' ? 'Meta.PlayerKillFlag.Player.Suicide' : `Meta.Progression.Context.Player.KillContext.${t}`,
        ),
        'Meta.PlayerKillFlag.Player.Local.Kill',
        'Meta.PlayerKillFlag.Player.Local.Death',
      ],
    });
  }

  drainEvents(id: string): FeedEvent[] {
    const s = this.servers.get(id);
    if (!s) return [];
    const out = s.events;
    s.events = [];
    return out;
  }

  source(id: string, clock: () => number): GameSource & { drainEvents(): FeedEvent[] } {
    const s = this.servers.get(id);
    if (!s) throw new Error(`unknown demo server ${id}`);
    return {
      status: async () => {
        this.advance(id, clock());
        return s.status(clock());
      },
      players: async () => s.players(),
      health: async () => ({ status: 'ok', uptimeSeconds: clock() - s.bootAt }),
      serverId: async () => `${s.cfg.id}-${s.matchId.slice(0, 8)}`,
      drainEvents: () => this.drainEvents(id),
    };
  }

  snapshot(id: string, now: number) {
    const s = this.servers.get(id)!;
    return { status: s.status(now), players: s.players() };
  }
}
