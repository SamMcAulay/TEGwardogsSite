// Player search without spending Warcon's per-key search limit: the org's all-time board
// export (up to 10,000 players) is held in memory and refreshed every 15 minutes.

export interface SearchHit {
  steamId: string;
  name: string;
  minutes: number;
  lastSeen: string | null;
}

/** One CSV line into cells: quoted cells may hold commas and doubled quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseBoardCsv(csv: string): SearchHit[] {
  const [head, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  const cols = cells(head);
  const at = (name: string) => cols.indexOf(name);
  const [id, name, minutes, lastSeen] = [at('steam_id'), at('name'), at('playtime_min'), at('last_seen')];
  return lines.map((line) => {
    const c = cells(line);
    return { steamId: c[id], name: c[name], minutes: Number(c[minutes]) || 0, lastSeen: c[lastSeen] || null };
  });
}

export class SearchIndex {
  private hits: SearchHit[] | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: { load: () => Promise<string>; refreshMs?: number; now?: () => number }) {
    this.refreshMs = opts.refreshMs ?? 15 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  get ready(): boolean {
    return this.hits !== null;
  }

  private refresh(): Promise<void> {
    return (this.loading ??= this.opts
      .load()
      .then((csv) => {
        this.hits = parseBoardCsv(csv).sort((a, b) => b.minutes - a.minutes);
        this.loadedAt = this.now();
      })
      .catch((e) => console.error('[search] board export failed:', e instanceof Error ? e.message : e))
      .finally(() => (this.loading = null)));
  }

  async search(q: string, limit = 25): Promise<SearchHit[] | 'warming'> {
    if (!this.hits || this.now() - this.loadedAt > this.refreshMs) await this.refresh();
    if (!this.hits) return 'warming';
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    if (/^\d{17}$/.test(query)) return this.hits.filter((h) => h.steamId === query);
    return this.hits.filter((h) => h.name.toLowerCase().includes(query)).slice(0, limit);
  }
}
