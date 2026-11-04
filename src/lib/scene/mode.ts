/** off: just the sky gradient; still: one frame; live: the loop. */
export function sceneMode(env: { webgl: boolean; reducedMotion: boolean }): 'off' | 'still' | 'live' {
  if (!env.webgl) return 'off';
  return env.reducedMotion ? 'still' : 'live';
}
