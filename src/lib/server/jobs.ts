// What the background jobs (page warmer, tier sync, round poster) last did, for the staff health
// panel. In memory only: a restart starts it empty. globalThis keeps one record per process.

export type JobName = 'warmer' | 'tierSync' | 'rounds' | 'alerts';

export interface JobState {
  /** unix seconds of the last finished pass */
  lastRun: number;
  /** unix seconds of the last pass without an error; null: none since start */
  lastOk: number | null;
  /** the last pass's error; null when it went fine */
  error: string | null;
  /** what the last pass did, e.g. "checked 3" */
  note: string | null;
}

const g = globalThis as unknown as { __jobs?: Map<JobName, JobState> };
const jobs = () => (g.__jobs ??= new Map());

export function jobRan(
  name: JobName,
  r: { error?: string | null; note?: string | null } = {},
  at = Math.floor(Date.now() / 1000),
): void {
  const prev = jobs().get(name);
  jobs().set(name, {
    lastRun: at,
    lastOk: r.error ? (prev?.lastOk ?? null) : at,
    error: r.error ?? null,
    note: r.note ?? null,
  });
}

/** null for a job that hasn't finished a pass since the process started. */
export const jobState = (name: JobName): JobState | null => jobs().get(name) ?? null;

/** Tests only. */
export function resetJobs(): void {
  jobs().clear();
}
