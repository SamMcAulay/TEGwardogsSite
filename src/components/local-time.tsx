'use client';
// Times in the viewer's own timezone. The server can't know it, so it renders UTC; once the page
// is running in the browser, React swaps in the viewer's (no mismatch, no flash of wrong layout).

import { useSyncExternalStore } from 'react';
import { date, dateTime } from '@/lib/format';

const noop = () => () => {};

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The viewer's IANA timezone in the browser; 'UTC' while rendering on the server. */
export function useViewerTz(): string {
  return useSyncExternalStore(noop, browserTz, () => 'UTC');
}

/** A moment as `14 Sep, 19:04` (or `14 Sep 2026` with `dateOnly`) in the viewer's time. */
export function LocalTime({ ts, dateOnly, className }: { ts: number; dateOnly?: boolean; className?: string }) {
  const tz = useViewerTz();
  const iso = new Date(ts * 1000).toISOString();
  return (
    <time dateTime={iso} title={`${dateTime(ts)}`} className={className}>
      {dateOnly ? date(ts, tz) : dateTime(ts, tz)}
    </time>
  );
}

/** "Times are in your time (Europe/London)", or "All times UTC" before the browser takes over. */
export function TimezoneNote() {
  const tz = useViewerTz();
  return <>{tz === 'UTC' ? 'All times UTC.' : `Times are in your timezone (${tz.replaceAll('_', ' ')}).`}</>;
}
