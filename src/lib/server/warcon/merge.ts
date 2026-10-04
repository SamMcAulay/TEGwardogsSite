// Calling every server and putting the answers together. A server that fails is left out and
// named, so a page can say which one is missing while still showing the rest.
import type { Cached } from './cache';

export interface Merged<T> {
  rows: T[];
  /** server ids whose call failed */
  failed: string[];
  /** some part was served from cache past its freshness */
  stale: boolean;
}

export async function fanOut<R>(
  serverIds: string[],
  load: (id: string) => Promise<Cached<R>>,
): Promise<{ ok: { id: string; value: R }[]; failed: string[]; stale: boolean }> {
  const settled = await Promise.allSettled(serverIds.map((id) => load(id)));
  const ok: { id: string; value: R }[] = [];
  const failed: string[] = [];
  let stale = false;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      ok.push({ id: serverIds[i], value: s.value.value });
      stale ||= s.value.stale;
    } else {
      failed.push(serverIds[i]);
    }
  });
  return { ok, failed, stale };
}

export function mergeNewest<T>(lists: T[][], at: (row: T) => number, limit: number): T[] {
  return lists.flat().sort((a, b) => at(b) - at(a)).slice(0, limit);
}
