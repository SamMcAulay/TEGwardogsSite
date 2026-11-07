// Keeps a Warcon reserved-slot group ("Premium (site)") equal to the linked Premium and staff
// SteamIDs. Run by hand from /admin. The group is created switched off and the site never switches
// it on: until someone does that in Warcon, nothing here reaches a game server. Everything in the
// group is the site's, so removing what is no longer wanted is safe. Needs WARCON_SLOTS_TOKEN, an
// org API key with only "Org reserved slots" over every server, and WARCON_ORG_ID.

export const SLOT_GROUP = 'Premium (site)';
const NOTE = 'TEG Premium/staff, synced from stats.tegwardogs.fyi';

export interface SlotSyncResult {
  added: number;
  removed: number;
  failed: number;
  /** whether the group is switched on in Warcon, i.e. whether these slots reach the servers */
  on: boolean;
}

export function slotSyncConfig(src: Record<string, string | undefined> = process.env) {
  const token = (src.WARCON_SLOTS_TOKEN ?? '').trim();
  const orgId = (src.WARCON_ORG_ID ?? '').trim();
  return token && orgId ? { token, orgId } : null;
}

export async function syncSlotGroup(opts: {
  baseUrl: string;
  token: string;
  orgId: string;
  steamIds: string[];
  fetch?: typeof fetch;
}): Promise<SlotSyncResult> {
  const doFetch = opts.fetch ?? fetch;
  const base = `${opts.baseUrl}/api/orgs/${encodeURIComponent(opts.orgId)}/slot-groups`;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${method} slot-groups${path}: Warcon answered HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const { groups } = await call<{ groups: { id: string; name: string; on: boolean }[] }>('GET', '');
  let group = groups.find((g) => g.name.toLowerCase() === SLOT_GROUP.toLowerCase());
  // A new group starts off (Warcon's rule), which is what keeps this inert until switched on.
  group ??= (await call<{ group: { id: string; name: string; on: boolean } }>('POST', '', { name: SLOT_GROUP, servers: 'every' })).group;
  const g = `/${encodeURIComponent(group.id)}/entries`;

  const { entries } = await call<{ entries: { steamId: string }[] }>('GET', g);
  const have = new Set(entries.map((e) => e.steamId));
  const want = new Set(opts.steamIds);
  const result: SlotSyncResult = { added: 0, removed: 0, failed: 0, on: group.on };

  // One at a time: each change makes Warcon re-sync the org's servers.
  for (const id of want) {
    if (have.has(id)) continue;
    try {
      await call('POST', g, { steamId: id, reason: NOTE });
      result.added++;
    } catch (e) {
      result.failed++;
      console.error('[slots] add failed:', e instanceof Error ? e.message : e);
    }
  }
  for (const id of have) {
    if (want.has(id)) continue;
    try {
      await call('DELETE', `${g}/${encodeURIComponent(id)}`);
      result.removed++;
    } catch (e) {
      result.failed++;
      console.error('[slots] remove failed:', e instanceof Error ? e.message : e);
    }
  }
  return result;
}
