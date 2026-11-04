// The helicopter's loop: circle, get shot down, crash into the tower, burn, start again.

export type Phase = 'fly' | 'missile' | 'falling' | 'burning';
export interface Story {
  phase: Phase;
  /** seconds spent in this phase */
  t: number;
}

export const FLY_S = 6;
export const FALL_S = 3.4;
export const BURN_S = 8;

const NEXT: Record<Phase, Phase> = { fly: 'missile', missile: 'falling', falling: 'burning', burning: 'fly' };
const LASTS: Record<Phase, number> = { fly: FLY_S, missile: Infinity, falling: FALL_S, burning: BURN_S };

/** The story after `dt` more seconds; the missile phase ends only when the world says it hit. */
export function advance(s: Story, dt: number, ev: { missileHit: boolean }): Story {
  const t = s.t + dt;
  const done = s.phase === 'missile' ? ev.missileHit : t >= LASTS[s.phase];
  return done ? { phase: NEXT[s.phase], t: 0 } : { phase: s.phase, t };
}
