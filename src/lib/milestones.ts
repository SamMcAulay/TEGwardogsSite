// Milestone badges on player profiles, from career totals and kills per weapon class. Client-safe.
import { WEAPON_CLASS_LABELS, type WeaponClass } from './weapon-classes';

export interface MilestoneTotals {
  kills: number;
  headshots: number;
  /** seconds */
  playtime: number;
  /** metres; 0 when unknown */
  longest: number;
  wins: number;
  matches: number;
  vehicleKills: number;
  /** most kills in one life */
  killStreak: number;
  classKills: Record<WeaponClass, number>;
}

export type MilestoneGroup = 'career' | 'class';

interface Track {
  key: string;
  group: MilestoneGroup;
  label: string;
  /** thresholds in the track's own unit, ascending */
  steps: number[];
  /** the track's value from the totals, in that unit */
  value: (t: MilestoneTotals) => number;
  /** a badge's text, e.g. "1K kills" */
  badge: (n: number) => string;
}

const short = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n));

/** How a class reads in a badge: "100 SMG kills". */
const CLASS_NOUN: Record<WeaponClass, string> = {
  assault: 'assault rifle',
  smg: 'SMG',
  sniper: 'sniper',
  marksman: 'marksman',
  lmg: 'LMG',
  shotgun: 'shotgun',
  pistol: 'pistol',
  explosive: 'explosive',
};

/** The same ladder for every weapon class, so they compare. */
const CLASS_STEPS = [25, 100, 250, 500, 1000, 2500];

export const TRACKS: Track[] = [
  { key: 'kills', group: 'career', label: 'Kills', steps: [100, 500, 1000, 2500, 5000, 10000], value: (t) => t.kills, badge: (n) => `${short(n)} kills` },
  { key: 'headshots', group: 'career', label: 'Headshots', steps: [50, 250, 1000, 2500, 5000], value: (t) => t.headshots, badge: (n) => `${short(n)} headshots` },
  { key: 'playtime', group: 'career', label: 'Time played', steps: [10, 50, 100, 250, 500, 1000], value: (t) => Math.floor(t.playtime / 3600), badge: (n) => `${short(n)} hours` },
  { key: 'longest', group: 'career', label: 'Longest kill', steps: [250, 500, 750, 1000], value: (t) => t.longest, badge: (n) => `${n} m shot` },
  { key: 'killStreak', group: 'career', label: 'Kill streak', steps: [5, 10, 15, 20, 30], value: (t) => t.killStreak, badge: (n) => `${n} in one life` },
  { key: 'vehicleKills', group: 'career', label: 'Vehicle kills', steps: [10, 50, 100, 250, 500], value: (t) => t.vehicleKills, badge: (n) => `${short(n)} vehicle kills` },
  { key: 'wins', group: 'career', label: 'Wins', steps: [10, 50, 100, 250, 500], value: (t) => t.wins, badge: (n) => `${short(n)} wins` },
  { key: 'matches', group: 'career', label: 'Rounds', steps: [25, 100, 250, 500, 1000], value: (t) => t.matches, badge: (n) => `${short(n)} rounds` },
  ...(Object.entries(WEAPON_CLASS_LABELS) as [WeaponClass, string][]).map(
    ([cls, label]): Track => ({
      key: `class:${cls}`,
      group: 'class',
      label,
      steps: CLASS_STEPS,
      value: (t) => t.classKills[cls] ?? 0,
      badge: (n) => `${short(n)} ${CLASS_NOUN[cls]} kills`,
    }),
  ),
];

export interface MilestoneProgress {
  key: string;
  group: MilestoneGroup;
  label: string;
  value: number;
  /** badges earned on this track, 0..steps */
  level: number;
  steps: number;
  /** the best badge earned, or null */
  earned: string | null;
  /** the next threshold and its badge, or null once every badge is earned */
  next: { at: number; badge: string } | null;
}

export function milestones(t: MilestoneTotals): MilestoneProgress[] {
  return TRACKS.map((track) => {
    const value = track.value(t);
    const level = track.steps.filter((s) => value >= s).length;
    const nextAt = track.steps[level];
    return {
      key: track.key,
      group: track.group,
      label: track.label,
      value,
      level,
      steps: track.steps.length,
      earned: level ? track.badge(track.steps[level - 1]) : null,
      next: nextAt === undefined ? null : { at: nextAt, badge: track.badge(nextAt) },
    };
  });
}
