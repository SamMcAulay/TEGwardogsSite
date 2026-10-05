/** Build `path?query` from the current params with some keys changed. Null/empty values are dropped. */
export function withParams(
  path: string,
  current: Record<string, string | string[] | undefined>,
  patch: Record<string, string | number | null | undefined>,
): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (typeof v === 'string' && v) out.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') out.delete(k);
    else out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `${path}?${s}` : path;
}

/** A page number from the query: floored, at least 1, at most 1000 (pages clamp further to their count). */
export function pageParam(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
