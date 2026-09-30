// Read-only client for the WARDOGS dedicated-server RCON HTTP API (WDRCON, default port 7776).
// Only the routes the stats site needs are wrapped. Field optionality follows what live builds
// actually send: CL-499480/CL-501228 omit `scoreCap` and `matchSeconds` from /v1/status.

export interface FactionScore {
  name: string;
  colorHex: string;
  score: number;
}

export interface ServerStatus {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string | null;
  alternator?: string | null;
  scoreTick?: { current: number; min: number; max: number };
  scoreCap?: number;
  matchSeconds?: number;
  players: { current: number; max: number };
  factionScores: FactionScore[];
  rotation?: { nowIndex: number; nextIndex: number };
}

export interface LivePlayer {
  name: string;
  steamId: string;
  faction: string;
  kills: number;
  deaths: number;
  cash: number;
  pingMs: number;
}

export interface ServerHealth {
  status: string;
  uptimeSeconds: number;
}

export class RconError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'RconError';
  }
}

/** The subset of the API the poller consumes, so the demo simulator can stand in for it. */
export interface GameSource {
  status(): Promise<ServerStatus>;
  players(): Promise<LivePlayer[]>;
  health(): Promise<ServerHealth | null>;
  serverId(): Promise<string | null>;
}

export class RconClient implements GameSource {
  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly timeoutMs = 4000,
  ) {}

  status() {
    return this.get<ServerStatus>('/v1/status');
  }

  async players() {
    const body = await this.get<{ players: LivePlayer[] }>('/v1/players');
    return body.players ?? [];
  }

  /** Optional route: older builds do not serve it. */
  async health() {
    return this.optional(() => this.get<ServerHealth>('/v1/health'));
  }

  /** Join code, served from CL-501228. */
  async serverId() {
    const body = await this.optional(() => this.get<{ serverId: string }>('/v1/server-id'));
    return body?.serverId ?? null;
  }

  private async optional<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (e) {
      if (e instanceof RconError && e.status === 404) return null;
      throw e;
    }
  }

  private async get<T>(route: string): Promise<T> {
    const url = this.baseUrl.replace(/\/+$/, '') + route;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.password}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: 'no-store',
      });
    } catch (e) {
      throw new RconError(`unreachable: ${(e as Error).message}`, null);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new RconError(`invalid JSON from ${route}`, res.status);
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new RconError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code ?? null);
    }
    return body as T;
  }
}
