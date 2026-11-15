// The weighted map rotation's way into a game server. Live builds have no live rotation routes
// (Warcon's "set next map" fails on them), but the rotation in the server's config document can be
// rewritten: the server rebuilds its rotation at once and plays the new order from the next map
// change. Tested on EU on 2026-11-15. Its own org API key, WARCON_ROTATION_TOKEN, with Warcon's
// "View" and "Config & settings" rights; only the rotation's lines are ever changed.

const SECTION = /(\[\/Script\/WDGame\.WDServerMapRotationSettings\][^[]*?!RotationEntries=ClearArray\r?\n)((?:\.RotationEntries=[^\r\n]*(?:\r?\n|$))*)/;

/** The rotation lines' values in a config document; null when it has no rotation section. */
export function rotationLines(text: string): string[] | null {
  const m = SECTION.exec(text);
  if (!m) return null;
  return m[2].split(/\r?\n/).filter(Boolean).map((l) => l.slice('.RotationEntries='.length));
}

/** The document with its rotation lines replaced; null when it has no rotation section. */
export function withRotation(text: string, entries: string[]): string | null {
  if (!SECTION.test(text)) return null;
  return text.replace(SECTION, (_, head: string) => head + entries.map((e) => `.RotationEntries=${e}\n`).join(''));
}

export interface RotationConfig {
  /** the rotation lines as the config document has them now */
  read(serverId: string): Promise<string[]>;
  /** puts these lines in, then checks the server's live rotation is them */
  write(serverId: string, entries: string[]): Promise<void>;
}

const fieldOf = (entry: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(entry)?.[1]?.toLowerCase() ?? '';

/** null when no key is set. */
export function rotationConfig(baseUrl: string, token: string | undefined, doFetch: typeof fetch = fetch): RotationConfig | null {
  const key = (token ?? '').trim();
  if (!key) return null;
  const call = async (serverId: string, action: string, body: Record<string, unknown> = {}) => {
    const res = await doFetch(`${baseUrl}/api/servers/${encodeURIComponent(serverId)}/rcon/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const said = (await res.json().catch(() => null)) as { message?: unknown; result?: unknown } | null;
    // A refused document's own words can quote the file, so only Warcon's short message is kept.
    if (!res.ok) throw new Error(`${action}: Warcon answered HTTP ${res.status}${typeof said?.message === 'string' ? `: ${said.message.slice(0, 200)}` : ''}`);
    return said?.result as Record<string, unknown>;
  };
  const doc = async (serverId: string) => {
    const d = await call(serverId, 'config');
    if (typeof d?.text !== 'string') throw new Error('config: Warcon sent no document');
    if (!d.writable) throw new Error('config: the document is read-only on this server');
    return { text: d.text, revision: String(d.revision ?? '') };
  };

  return {
    async read(serverId) {
      const lines = rotationLines((await doc(serverId)).text);
      if (!lines) throw new Error('config: the document has no map rotation section');
      return lines;
    },
    async write(serverId, entries) {
      for (let attempt = 0; ; attempt++) {
        const d = await doc(serverId);
        const text = withRotation(d.text, entries);
        if (!text) throw new Error('config: the document has no map rotation section');
        const r = await call(serverId, 'configApply', { text, revision: d.revision });
        if (r?.ok) break;
        // Someone applied the document in between: once more on the new revision.
        if (r?.conflict && !attempt) continue;
        throw new Error(r?.conflict ? 'configApply: the document kept changing' : 'configApply: the server did not take the rotation');
      }
      const live = (await call(serverId, 'rotation')) as { enabled?: boolean; entries?: { map: string; lighting: string }[] };
      const want = entries.map((e) => `${fieldOf(e, 'Map')}/${fieldOf(e, 'Lighting')}`);
      const got = (live?.entries ?? []).map((e) => `${e.map.toLowerCase()}/${e.lighting.toLowerCase()}`);
      if (got.join() !== want.join()) throw new Error(`the server still shows ${got.join(', ') || 'no rotation'} after the write`);
      if (live.enabled === false) throw new Error('the rotation is switched off on this server');
    },
  };
}
