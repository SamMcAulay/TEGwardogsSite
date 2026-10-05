// One page section's data: rendered when it loaded, flagged when part of it is stale or a
// server is missing, and replaced by a notice when it failed. Warcon's error text goes to the
// server log, never to visitors.
import type { ReactNode } from 'react';
import type { Loaded } from '@/lib/server/views';

export function sectionState(r: Loaded<unknown> | Error): 'ok' | 'stale' | 'down' {
  if (r instanceof Error) return 'down';
  return r.stale || r.missing.length ? 'stale' : 'ok';
}

/** Await a data call without throwing: a failure becomes an Error value for <Section>. */
export async function safe<T>(p: Promise<T>): Promise<T | Error> {
  try {
    return await p;
  } catch (e) {
    console.error('[data]', e instanceof Error ? e.message : e);
    return e instanceof Error ? e : new Error(String(e));
  }
}

export function Section<T>({ loaded, children }: { loaded: Loaded<T> | Error; children: (data: T) => ReactNode }) {
  const state = sectionState(loaded);
  if (state === 'down' || loaded instanceof Error) {
    return <p className="px-4 py-6 text-sm text-muted">Stats are temporarily unavailable. Try again in a minute.</p>;
  }
  return (
    <>
      {children(loaded.data)}
      {state === 'stale' && (
        <p className="px-4 pb-3 text-xs text-dim">
          {loaded.missing.length ? `${loaded.missing.length} server(s) didn't answer; ` : ''}may be out of date.
        </p>
      )}
    </>
  );
}
