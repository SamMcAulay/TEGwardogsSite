// Milestone badges on player profiles, from career totals. Client-safe.

export interface MilestoneTotals {
  kills: number;
  headshots: number;
  /** seconds */
  playtime: number;
  /** metres; 0 when unknown */
  longest: number;
  wins: number;
  matches: number;
}

interface Track {
  key: keyof MilestoneTotals;
  label: string;
  /** thresholds in the track's own unit, ascending */
  steps: number[];
  /** the track's value from the totals, in that unit */
  value: (t: MilestoneTotals) => number;
  /** a badge's text, e.g. "1K kills" */
  badge: (n: number) => string;
}

const short = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n));

export const TRACKS: Track[] = [
  { key: 'kills', label: 'Kills', steps: [100, 500, 1000, 2500, 5000, 10000], value: (t) => t.kills, badge: (n) => `${short(n)} kills` },
  { key: 'headshots', label: 'Headshots', steps: [50, 250, 1000, 2500, 5000], value: (t) => t.headshots, badge: (n) => `${short(n)} headshots` },
  { key: 'playtime', label: 'Time played', steps: [10, 50, 100, 250, 500, 1000], value: (t) => Math.floor(t.playtime / 3600), badge: (n) => `${short(n)} hours` },
  { key: 'longest', label: 'Longest kill', steps: [250, 500, 750, 1000], value: (t) => t.longest, badge: (n) => `${n} m shot` },
  { key: 'wins', label: 'Wins', steps: [10, 50, 100, 250, 500], value: (t) => t.wins, badge: (n) => `${short(n)} wins` },
  { key: 'matches', label: 'Rounds', steps: [25, 100, 250, 500, 1000], value: (t) => t.matches, badge: (n) => `${short(n)} rounds` },
];

export interface MilestoneProgress {
  key: Track['key'];
  label: string;
  value: number;
  /** badges earned on this track, 0..steps.length */
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
      label: track.label,
      value,
      level,
      steps: track.steps.length,
      earned: level ? track.badge(track.steps[level - 1]) : null,
      next: nextAt === undefined ? null : { at: nextAt, badge: track.badge(nextAt) },
    };
  });
}
