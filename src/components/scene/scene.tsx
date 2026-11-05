'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { approach, viewOffset } from '@/lib/scene/framing';
import { sceneMode } from '@/lib/scene/mode';
import { advance, type Story } from '@/lib/scene/story';

function hasWebgl(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** The page's gap for the island, in page coordinates; null on pages without one. */
function gapBox() {
  const el = document.querySelector('[data-scene-gap]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top + window.scrollY, width: r.width, height: r.height };
}

/**
 * The sky-island scene behind every page. Lives in the root layout, so navigating never restarts it;
 * three.js loads after first paint. Without WebGL only the sky gradient (body.sky) shows.
 */
export function Scene() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Still mode draws only on demand: after a resize (which clears the canvas) and on each new page.
  const redraw = useRef<(() => void) | null>(null);
  const path = usePathname();
  useEffect(() => {
    const id = requestAnimationFrame(() => redraw.current?.());
    return () => cancelAnimationFrame(id);
  }, [path]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const mode = sceneMode({ webgl: hasWebgl(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    if (mode === 'off') return;
    let stop = false,
      raf = 0,
      dispose = () => {};
    import('./world').then(({ createWorld }) => {
      if (stop) return;
      const w = createWorld(canvas);
      dispose = w.dispose;
      const off = { x: 0, y: 0 };
      const size = () => {
        w.resize(window.innerWidth, window.innerHeight);
        redraw.current?.();
      };
      size();
      window.addEventListener('resize', size);
      const prevDispose = dispose;
      dispose = () => {
        window.removeEventListener('resize', size);
        prevDispose();
      };
      const place = (dt: number) => {
        const t = viewOffset({ w: window.innerWidth, h: window.innerHeight }, gapBox());
        off.x = dt ? approach(off.x, t.x, dt) : t.x;
        off.y = dt ? approach(off.y, t.y, dt) : t.y;
        w.setOffset(off.x, off.y);
      };
      if (mode === 'still') {
        // One frame with the helicopter mid-circle, redrawn (not advanced) when needed.
        place(0);
        w.frame(4, { phase: 'fly', t: 4 });
        redraw.current = () => {
          place(0);
          w.frame(0, { phase: 'fly', t: 4 });
        };
        return;
      }
      let story: Story = { phase: 'fly', t: 0 },
        last = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (document.hidden) return;
        place(dt);
        const { missileHit } = w.frame(dt, story);
        story = advance(story, dt, { missileHit });
      };
      raf = requestAnimationFrame(loop);
    });
    return () => {
      stop = true;
      redraw.current = null;
      cancelAnimationFrame(raf);
      dispose();
    };
  }, []);
  return <canvas ref={ref} aria-hidden style={{ viewTransitionName: 'site-scene' }} className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
