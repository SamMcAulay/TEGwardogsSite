// Where the sky-island sits on screen. Client-safe, no three.js.

type Box = { left: number; top: number; width: number; height: number };

/**
 * Camera view offset that centres the island on `gap` (the empty area a page leaves for it, in page
 * coordinates so scrolling never moves it); centred when there is none. Positive x moves it left.
 */
export function viewOffset(view: { w: number; h: number }, gap: Box | null): { x: number; y: number } {
  if (!gap) return { x: 0, y: 0 };
  return { x: view.w / 2 - (gap.left + gap.width / 2), y: view.h / 2 - (gap.top + Math.min(gap.top + gap.height, view.h)) / 2 };
}

/** Eases `current` toward `target` over `dt` seconds; exponential, so it can never overshoot. */
export function approach(current: number, target: number, dt: number, rate = 4): number {
  return target + (current - target) * Math.exp(-rate * dt);
}
