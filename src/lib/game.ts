// Game vocabulary: map, faction, weapon and kill-context names as the WARDOGS server reports them.
// Client-safe.

/** Map ids as the RCON catalog lists them, to their in-game names. */
export const MAPS: Record<string, string> = {
  Kavkazi: 'Bakurani',
  Europe: 'Ozeti',
  NorthAmerica: 'Zestafona',
};

export function mapName(map: string | null | undefined): string {
  if (!map) return 'Unknown';
  return MAPS[map] ?? map;
}

/**
 * TEG's map rotation, the same on every server, in the order the Warcon panel lists it. The server
 * only reports slot numbers, so a change to the rotation in the panel needs this list changed too.
 */
export const ROTATION: readonly { map: string; lighting: string }[] = [
  { map: 'Bakurani', lighting: 'DayLateRain' },
  { map: 'Ozeti', lighting: 'DayStartClear' },
  { map: 'Zestafona', lighting: 'DayClear' },
  { map: 'Ozeti', lighting: 'DayLateRain' },
  { map: 'Zestafona', lighting: 'DayStartClear' },
  { map: 'Bakurani', lighting: 'DayClear' },
  { map: 'Zestafona', lighting: 'DayLateRain' },
  { map: 'Bakurani', lighting: 'DayStartClear' },
  { map: 'Ozeti', lighting: 'DayClear' },
];

/** Screenshots in public/maps for each rotation map and time of day. */
export function mapArt(map: string, lighting: string | null): string | null {
  const known = ROTATION.some((r) => r.map === map && r.lighting === lighting);
  return known ? `/maps/${map}-${lighting}.webp` : null;
}

export interface RotationStop {
  map: string;
  lighting: string | null;
  /** 0-based slot in ROTATION; null: not a rotation map (an admin's pick) */
  slot: number | null;
}

/**
 * The previous, current and next maps. Current is always what the server says is on, even if the
 * panel's rotation has drifted from ROTATION; previous and next come from the slot numbers.
 * Null when the server reports no rotation at all.
 */
export function rotationView(
  live: { map: string; lighting: string | null; rotation: { now: number | null; next: number | null } },
  list: readonly { map: string; lighting: string }[] = ROTATION,
): { prev: RotationStop | null; now: RotationStop; next: RotationStop | null; length: number } | null {
  const n = list.length;
  const { now, next } = live.rotation;
  const inList = (i: number | null): i is number => i != null && Number.isInteger(i) && i >= 0;
  if (!n || (!inList(now) && !inList(next))) return null;
  const at = (i: number): RotationStop => {
    const slot = ((i % n) + n) % n;
    return { ...list[slot], slot };
  };
  return {
    // Off rotation, nothing says which slot came before.
    prev: inList(now) ? at(now - 1) : null,
    now: { map: live.map, lighting: live.lighting, slot: inList(now) ? now % n : null },
    next: inList(next) ? at(next) : inList(now) ? at(now + 1) : null,
    length: n,
  };
}

/**
 * Seconds until each rotation slot comes up next, the current slot null. untilNext is how long the
 * round in progress has left; every later round is taken to run a typical round's length. Null when
 * the server is off rotation or either time is unknown.
 */
export function rotationStarts(
  nowSlot: number | null,
  length: number,
  untilNext: number | null,
  roundSeconds: number | null,
): (number | null)[] | null {
  if (nowSlot == null || nowSlot < 0 || !length || untilNext == null || !roundSeconds || roundSeconds <= 0) return null;
  return Array.from({ length }, (_, i) => {
    const ahead = (((i - nowSlot) % length) + length) % length;
    return ahead === 0 ? null : untilNext + (ahead - 1) * roundSeconds;
  });
}

/** The middle length of finished rounds, in seconds; null with none. */
export function typicalRound(rounds: { startedAt: number; endedAt: number | null }[]): number | null {
  const lengths = rounds
    .filter((r) => r.endedAt != null && r.endedAt > r.startedAt)
    .map((r) => r.endedAt! - r.startedAt)
    .sort((a, b) => a - b);
  if (!lengths.length) return null;
  const mid = lengths.length >> 1;
  return lengths.length % 2 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2);
}

/** King of the Hill's winning score. The server doesn't report it; every finished round has ended at 100. */
export const KOTH_CAP = 100;

/**
 * Finished rounds ran about 1.1x (points scored x scoreTick): the hill sits contested or empty some of
 * the time (100/83/67 took 1h52m and 100/46/37 took 1h21m at a 24 s tick, ~26.7 s a point).
 */
const TICK_SLACK = 1.1;

/**
 * About how long until someone reaches the cap, in seconds. Only the team holding the hill scores, so
 * points arrive at about one per tick across all teams and the leader takes its share of them. The
 * share is smoothed so a 3-0 start doesn't read as a sure thing. Null before anyone has scored.
 */
export function roundEta(scores: number[], tickSeconds: number | null, cap: number | null): number | null {
  if (!tickSeconds || tickSeconds <= 0 || !cap || !scores.length) return null;
  const lead = Math.max(...scores);
  const total = scores.reduce((a, s) => a + s, 0);
  if (total <= 0) return null;
  if (lead >= cap) return 0;
  const share = (lead + 1) / (total + scores.length);
  return Math.round(((cap - lead) / share) * tickSeconds * TICK_SLACK);
}

export const FACTIONS: Record<string, { color: string; short: string }> = {
  Valkyra: { color: '#D86060', short: 'VAL' },
  Lonestar: { color: '#5B95D8', short: 'LON' },
  Manticore: { color: '#7BC462', short: 'MAN' },
};

export function factionColor(name: string | null | undefined, fallback = '#8b93a1'): string {
  return (name && FACTIONS[name]?.color) || fallback;
}

/**
 * The faction a player is loyal to: one known faction holding at least `threshold` of their rounds.
 * Warcon only splits a career by rounds, not seconds, so round share stands in for play time.
 */
export function mainFaction(factions: { key: string; matches: number }[], threshold = 0.65): string | null {
  const total = factions.reduce((a, f) => a + f.matches, 0);
  if (!total) return null;
  const top = factions.reduce((a, b) => (b.matches > a.matches ? b : a));
  return FACTIONS[top.key] && top.matches / total >= threshold ? top.key : null;
}

export function experienceName(id: string): string {
  if (/KOTH_Hardcore/i.test(id)) return 'Hardcore';
  if (/KOTH_InfantryOnly/i.test(id)) return 'Infantry only';
  if (/_KOTH_/i.test(id)) return 'King of the Hill';
  return pretty(id);
}

export function lightingName(id: string | null | undefined): string {
  if (!id) return '';
  return (
    pretty(id.replace(/^Day/, ''))
      .replace(/^Start/, 'Dawn')
      .replace(/^End/, 'Dusk') || 'Day'
  );
}

export type CauseKind = 'weapon' | 'explosive' | 'vehicle' | 'vehicle weapon' | 'buildable' | 'other';

interface CauseInfo {
  label: string;
  kind: CauseKind;
}

const C = (label: string, kind: CauseKind): CauseInfo => ({ label, kind });

/** Kill feed `cause` tags. Unknown tags fall back to a readable form of their last segment. */
const CAUSES: Record<string, CauseInfo> = {
  'id.item.ak74m': C('AK-74M', 'weapon'),
  'id.item.wepn_029': C('Galil', 'weapon'),
  'id.item.m4': C('M4', 'weapon'),
  'id.item.m500': C('M500', 'weapon'),
  'id.item.mp43': C('MP43', 'weapon'),
  'id.item.sks': C('SKS', 'weapon'),
  'id.item.svdm': C('SVDM', 'weapon'),
  'id.item.kh2002': C('KH2002', 'weapon'),
  'id.item.tar21': C('TAR-21', 'weapon'),
  'id.item.a91': C('A-91', 'weapon'),
  'id.item.sv98': C('SV-98', 'weapon'),
  'id.item.rpg7': C('RPG-7', 'explosive'),
  'id.item.mk22': C('MK 22', 'weapon'),
  'id.item.glock17': C('Glock 17', 'weapon'),
  'id.item.combatbow': C('Combat Bow', 'weapon'),
  'id.item.m67grenade': C('M67 Grenade', 'explosive'),
  'id.item.c4explosive': C('C4', 'explosive'),
  'id.item.ied.explosive': C('IED', 'explosive'),
  'id.item.atmine': C('AT Mine', 'explosive'),
  'id.item.claymore': C('Claymore', 'explosive'),
  'id.item.crowbar': C('Halligan Bar', 'weapon'),
  'id.item.fists': C('Fists', 'weapon'),
  'id.item.defibrillator.standard': C('Defibrillator', 'weapon'),
  'id.item.buildtool.hammer.large': C('Large Hammer', 'weapon'),
  'id.item.buildtool.hammer.medium': C('Medium Hammer', 'weapon'),
  'id.item.buildtool.hammer.small': C('Small Hammer', 'weapon'),
  'id.buildable.bremmerwall': C('Bremer Wall', 'buildable'),
  'id.buildable.barbedwire': C('Barbed Wire', 'buildable'),
  'id.buildable.hblock': C('H-Block', 'buildable'),
  'id.buildable.tallhblock': C('Tall H-Block', 'buildable'),
  'vehicle.variant.air.rotary.littlebird.default': C('MH-6', 'vehicle'),
  'vehicle.variant.air.rotary.littlebird.mountedmachineguns': C('AH-6M', 'vehicle'),
  'vehicle.variant.air.rotary.littlebird.rocketpods': C('AH-6R', 'vehicle'),
  'vehicle.variant.air.rotary.rot_04.default': C('Z20 Lakota', 'vehicle'),
  'vehicle.variant.land.tracked.tnk_01.antiair': C('Flakpanzer Gepard', 'vehicle'),
  'vehicle.variant.land.tracked.tnk_01.heavy': C('L2A6', 'vehicle'),
  'vehicle.variant.land.tracked.tnk_01.artillery': C('SPH-2', 'vehicle'),
  'vehicle.variant.land.tracked.spawnvehicle.lonestar': C('M113 APC', 'vehicle'),
  'vehicle.variant.land.tracked.spawnvehicle.valkyra': C('M113 APC', 'vehicle'),
  'vehicle.variant.land.tracked.spawnvehicle.manticore': C('M113 APC', 'vehicle'),
  'vehicle.variant.land.wheeled.humvee.machinegun': C('Humvee (M249)', 'vehicle'),
  'vehicle.variant.land.wheeled.humvee.minigun': C('Humvee (Minigun)', 'vehicle'),
  'vehicle.variant.land.wheeled.kodiak.machinegun': C('Kodiak (M249)', 'vehicle'),
  'vehicle.variant.land.wheeled.kodiak.pickup': C('Kodiak', 'vehicle'),
  'vehicle.variant.land.wheeled.ural.battle': C('Ural Defender', 'vehicle'),
  'vehicle.variant.stationary.phalanx': C('Vanguard CIWS', 'vehicle weapon'),
  'vehicle.variant.stationary.mortar': C('L81 Mortar', 'vehicle weapon'),
  'vehicle.variant.stationary.mistralaa': C('Talon 9K-SAM', 'vehicle weapon'),
  'id.vehicle.weaponextension.rot_02.30mmcannon': C('Havoc 30mm Cannon', 'vehicle weapon'),
  'id.vehicle.weaponextension.rot_02.122mm': C('Havoc Rockets', 'vehicle weapon'),
  'id.vehicle.weaponextension.rot_03.mountedmachinegun': C('AH-6M Miniguns', 'vehicle weapon'),
  'id.vehicle.weaponextension.rot_03.rocketpods': C('AH-6R Rockets', 'vehicle weapon'),
  'id.vehicle.weaponextension.rot_04.mountedmachinegun': C('Z20 Lakota Miniguns', 'vehicle weapon'),
  'id.vehicle.weaponextension.tnk_01.artillery': C('SPH-2 Artillery', 'vehicle weapon'),
  'id.vehicle.weaponextension.tnk_01.heavy': C('L2A6 Cannon', 'vehicle weapon'),
  'id.vehicle.weaponextension.tnk_01.machinegun': C('L2A6 Coax MG', 'vehicle weapon'),
  'id.vehicle.weaponextension.whl_02.suv.ringturret': C('Kodiak M249', 'vehicle weapon'),
  'id.vehicle.weaponextension.whl_05.ringturret': C('Humvee M249', 'vehicle weapon'),
  'id.vehicle.weaponextension.whl_05.ringminigun': C('Humvee Minigun', 'vehicle weapon'),
  'id.vehicle.weaponextension.whl_07.machinegun': C('Ural M249', 'vehicle weapon'),
};

export function causeInfo(cause: string | null | undefined): CauseInfo {
  if (!cause) return { label: 'Environment', kind: 'other' };
  const known = CAUSES[cause.toLowerCase()];
  if (known) return known;
  const kind: CauseKind = /^id\.vehicle\.weaponextension\./i.test(cause)
    ? 'vehicle weapon'
    : /^vehicle\./i.test(cause)
      ? 'vehicle'
      : /^id\.buildable\./i.test(cause)
        ? 'buildable'
        : 'weapon';
  const segments = cause.split('.').filter((s) => !/^(id|item|default|variant)$/i.test(s));
  return { label: pretty(segments.slice(-1)[0] ?? cause), kind };
}

export const causeLabel = (cause: string | null | undefined) => causeInfo(cause).label;

const KILL_CONTEXT = 'meta.progression.context.player.killcontext.';

/** Short context tags (`Headshot`, `RoadKill`, ...) from the feed's `contextTags`. */
export function killContexts(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const lower = t.toLowerCase();
    if (lower.startsWith(KILL_CONTEXT)) out.push(t.slice(KILL_CONTEXT.length));
    else if (lower.endsWith('.suicide')) out.push('Suicide');
  }
  return out;
}

function pretty(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

export const REGION_NAMES: Record<string, string> = {
  NA: 'North America',
  EU: 'Europe',
  OCE: 'Oceania',
  ASIA: 'Asia',
  SA: 'South America',
};
