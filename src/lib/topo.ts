// Topographic contour lines for map backdrops, generated from seeded value noise with marching
// squares. Deterministic per seed, so each WARDOGS map gets its own recognisable terrain.

const W = 64;
const H = 36;

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

function lattice(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function noise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = lattice(seed, xi, yi);
  const b = lattice(seed, xi + 1, yi);
  const c = lattice(seed, xi, yi + 1);
  const d = lattice(seed, xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function field(seed: number): number[][] {
  const out: number[][] = [];
  for (let y = 0; y <= H; y++) {
    const row: number[] = [];
    for (let x = 0; x <= W; x++) {
      let v = 0;
      let amp = 1;
      let freq = 1 / 14;
      for (let o = 0; o < 4; o++) {
        v += noise(seed + o * 101, x * freq, y * freq) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      row.push(v / 1.875);
    }
    out.push(row);
  }
  return out;
}

const cache = new Map<string, string[]>();

/** SVG path data (viewBox `0 0 64 36`), one path per contour level. */
export function contours(seed: string, levels = 11): string[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const f = field(hash(seed));
  const paths: string[] = [];
  for (let l = 1; l <= levels; l++) {
    const iso = 0.2 + (l / (levels + 1)) * 0.62;
    let d = '';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = f[y][x];
        const b = f[y][x + 1];
        const c = f[y + 1][x + 1];
        const e = f[y + 1][x];
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (e > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const lerp = (p: number, q: number) => (iso - p) / (q - p);
        const top: [number, number] = [x + lerp(a, b), y];
        const right: [number, number] = [x + 1, y + lerp(b, c)];
        const bottom: [number, number] = [x + lerp(e, c), y + 1];
        const left: [number, number] = [x, y + lerp(a, e)];
        const seg = (p: [number, number], q: [number, number]) =>
          `M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
        switch (idx) {
          case 1:
          case 14:
            d += seg(left, bottom);
            break;
          case 2:
          case 13:
            d += seg(bottom, right);
            break;
          case 3:
          case 12:
            d += seg(left, right);
            break;
          case 4:
          case 11:
            d += seg(top, right);
            break;
          case 5:
            d += seg(left, top) + seg(bottom, right);
            break;
          case 6:
          case 9:
            d += seg(top, bottom);
            break;
          case 7:
          case 8:
            d += seg(left, top);
            break;
          case 10:
            d += seg(top, right) + seg(left, bottom);
            break;
        }
      }
    }
    paths.push(d);
  }
  cache.set(seed, paths);
  return paths;
}
