// The deploy gate's checks: the key works, has View, sees the servers, and every endpoint the
// site reads answers in the shape the schemas expect.
import type { WarconApi } from './api';
import type { SiteEnv } from './env';
import { WarconError } from './http';

export interface Check { name: string; ok: boolean; detail: string }

const why = (e: unknown) =>
  e instanceof WarconError
    ? e.kind === 'rejected' ? 'key rejected (401): check WARCON_TOKEN'
    : e.kind === 'forbidden' ? 'key lacks the View capability (403)'
    : e.message
    : e instanceof Error ? e.message : String(e);

export async function runChecks(api: WarconApi, env: SiteEnv): Promise<Check[]> {
  let servers;
  try {
    servers = (await api.servers()).value;
  } catch (e) {
    return [{ name: 'key', ok: false, detail: why(e) }];
  }
  const out: Check[] = [{ name: 'key', ok: servers.length > 0, detail: `accepted; sees ${servers.length} server(s)` }];
  const unknown = env.serverIds.filter((id) => !servers.some((s) => s.id === id));
  if (env.serverIds.length) out.push({ name: 'SERVER_IDS', ok: unknown.length === 0, detail: unknown.length ? `not visible to the key: ${unknown.join(', ')}` : 'all visible' });

  const ids = env.serverIds.length ? env.serverIds.filter((id) => !unknown.includes(id)) : servers.map((s) => s.id);
  for (const id of ids) {
    const checks: [string, () => Promise<unknown>][] = [
      ['summary', () => api.live(id)],
      ['leaderboard', () => api.board(id, { scope: 'org', range: '7d', sort: 'kills' })],
      ['matches', () => api.matches(id)],
      ['kills', () => api.kills(id, { limit: 1 })],
      ['analytics', () => api.analytics(id, '24h')],
      ['players/seen', () => api.seen(id, { limit: 1 })],
    ];
    for (const [name, run] of checks) {
      try {
        await run();
        out.push({ name: `${name} (${id})`, ok: true, detail: 'answered' });
      } catch (e) {
        out.push({ name: `${name} (${id})`, ok: false, detail: why(e) });
      }
    }
  }
  try {
    const csv = await api.boardExportCsv(ids[0] ?? servers[0].id);
    out.push({ name: 'search index export', ok: csv.startsWith('rank,steam_id'), detail: `${csv.split('\n').length - 1} rows` });
  } catch (e) {
    out.push({ name: 'search index export', ok: false, detail: why(e) });
  }
  return out;
}
