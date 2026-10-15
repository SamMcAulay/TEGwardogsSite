// Tags on a server's live scoreboard. "New": a player's first session, or first 45 minutes, on
// TEG's servers. "Blue Imposter" / "Blue Lover": Lonestar got a buff after season one, so a
// season-one Valkyra or Manticore main now on Lonestar is an imposter, and a Lonestar main is a
// lover whichever side they're on. Season-one mains are a frozen snapshot (season-one-factions.json).
import seasonOne from './season-one-factions.json';

export type LiveTag = 'new' | 'imposter' | 'lover';

export const NEW_MINUTES = 45;
const RECHECK_MS = 5 * 60_000;
/** Lookups at once: leaves Warcon's player-lookup slots free for profile pages. */
const LOOKUPS_AT_ONCE = 2;

type Faction = 'Lonestar' | 'Valkyra' | 'Manticore';
const MAINS = new Map<string, Faction>();
for (const f of ['Lonestar', 'Valkyra', 'Manticore'] as const) for (const id of seasonOne[f]) MAINS.set(id, f);

/** The faction a player spent most of season one on (at least 45 minutes played), if any. */
export const seasonOneMain = (steamId: string): Faction | null => MAINS.get(steamId) ?? null;

export function factionTag(playingFor: string, main: string | null): LiveTag | null {
  if (!main || !playingFor) return null;
  if (main === 'Lonestar') return 'lover';
  return playingFor === 'Lonestar' ? 'imposter' : null;
}

export const isNewPlayer = (s: { sessions: number; minutes: number }) => s.minutes < NEW_MINUTES || s.sessions <= 1;

export interface NewTagDeps {
  /** org-wide sessions and minutes; throws when Warcon can't say */
  summary: (steamId: string) => Promise<{ sessions: number; minutes: number }>;
  /** all-time minutes from the search index, when the player is in it */
  knownMinutes: (steamId: string) => Promise<number | null>;
  now?: () => number;
}

/**
 * Who is new, remembered per process. Someone found not new never becomes new again, so they're
 * never asked about twice; a new player is asked again after five minutes. Season-one mains and
 * anyone in the search index past 45 minutes are known without asking Warcon at all.
 */
export class NewPlayers {
  private veterans = new Set<string>();
  private fresh = new Map<string, number>();
  private pending = new Map<string, Promise<void>>();
  private queue: { steamId: string; done: () => void }[] = [];
  private running = 0;
  private readonly now: () => number;

  constructor(private readonly deps: NewTagDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Which of these players are new, waiting at most waitMs for lookups; the rest fill in later. */
  async check(steamIds: string[], waitMs = 1500): Promise<Set<string>> {
    // Forget new players not seen for an hour: they have left, or are past 45 minutes anyway.
    for (const [id, at] of this.fresh) if (this.now() - at > 3_600_000) this.fresh.delete(id);
    const work = steamIds.map((id) => this.lookup(id)).filter((p) => p !== null);
    if (work.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(work), new Promise((r) => (timer = setTimeout(r, waitMs)))]);
      clearTimeout(timer);
    }
    return new Set(steamIds.filter((id) => this.fresh.has(id)));
  }

  /** null when the answer is already known and current. */
  private lookup(steamId: string): Promise<void> | null {
    if (this.veterans.has(steamId) || seasonOneMain(steamId)) return null;
    const checkedAt = this.fresh.get(steamId);
    if (checkedAt !== undefined && this.now() - checkedAt < RECHECK_MS) return null;
    let p = this.pending.get(steamId);
    if (!p) {
      p = new Promise<void>((done) => {
        this.queue.push({ steamId, done });
        this.drain();
      }).finally(() => this.pending.delete(steamId));
      this.pending.set(steamId, p);
    }
    return p;
  }

  private drain() {
    while (this.running < LOOKUPS_AT_ONCE && this.queue.length) {
      const { steamId, done } = this.queue.shift()!;
      this.running++;
      void this.ask(steamId).finally(() => {
        this.running--;
        done();
        this.drain();
      });
    }
  }

  private async ask(steamId: string) {
    try {
      const known = await this.deps.knownMinutes(steamId);
      const isNew = known !== null && known >= NEW_MINUTES ? false : isNewPlayer(await this.deps.summary(steamId));
      if (isNew) this.fresh.set(steamId, this.now());
      else {
        this.fresh.delete(steamId);
        this.veterans.add(steamId);
      }
    } catch {
      // Warcon busy or down: leave them untagged and ask again next time.
    }
  }
}
