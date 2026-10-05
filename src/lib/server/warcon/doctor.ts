// The deploy gate's checks: the key works, has View, sees the servers, and every endpoint the
// site reads answers in the shape the schemas expect, including a real player's dossier and
// career and an ended match.
import type { WarconApi } from './api';
import type { SiteEnv } from './env';
import { WarconError } from './http';
import { parseBoardCsv } from './search';

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
  const first = ids[0] ?? servers[0]?.id;
  if (!first) return out; // the key check already failed: nothing to probe

  const check = async (name: string, run: () => Promise<string>) => {
    try {
      out.push({ name, ok: true, detail: await run() });
    } catch (e) {
      out.push({ name, ok: false, detail: why(e) });
    }
  };
  const skip = (name: string) => out.push({ name, ok: true, detail: 'skipped: no data' });

  // The search index's export; its first player probes the dossier and career schemas.
  let steamId: string | undefined;
  await check('search index export', async () => {
    const hits = parseBoardCsv(await api.boardExportCsv(first));
    steamId = hits[0]?.steamId;
    return `${hits.length} players`;
  });
  if (steamId) {
    const id = steamId;
    await check('player dossier', async () => {
      await api.dossier(first, id);
      return `answered for ${id}`;
    });
    await check('player career', async () => {
      await api.career(first, id);
      return `answered for ${id}`;
    });
  } else {
    skip('player dossier');
    skip('player career');
  }

  let matchId: number | undefined;
  try {
    matchId = (await api.matches(first)).value.matches.find((m) => m.endedAt)?.id;
  } catch {
    // already reported as "matches (<id>)" above
  }
  if (matchId !== undefined) {
    const id = matchId;
    await check('match view', async () => {
      await api.match(first, id);
      return `answered for match ${id}`;
    });
  } else skip('match view');

  // Never throws (avatars are decoration), so this only reports what came back.
  if (steamId) {
    const got = await api.steamProfiles([steamId]);
    out.push({
      name: 'steam profiles (warning)',
      ok: true,
      detail: `${Object.keys(got).length} of 1 profile(s) returned${Object.keys(got).length ? '' : ': avatars will show as badges (no Steam key on the panel?)'}`,
    });
  } else skip('steam profiles (warning)');
  return out;
}
