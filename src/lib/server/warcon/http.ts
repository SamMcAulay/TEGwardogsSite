// The only code that talks to Warcon over HTTP. Answers are parsed with a zod schema, which
// also drops every field the schema does not name: that is the site's privacy boundary.
import type { z } from 'zod';

export type WarconErrorKind = 'unreachable' | 'timeout' | 'rejected' | 'forbidden' | 'not_found' | 'http' | 'schema';

export class WarconError extends Error {
  constructor(
    message: string,
    readonly kind: WarconErrorKind,
    readonly status: number | null,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'WarconError';
  }
}

export interface Warcon {
  json<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  text(path: string): Promise<string>;
}

const KIND_OF: Record<number, WarconErrorKind> = { 401: 'rejected', 403: 'forbidden', 404: 'not_found' };

export function createWarcon(opts: { baseUrl: string; token: string; timeoutMs?: number; fetch?: typeof fetch }): Warcon {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function request(path: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${opts.token}`, accept },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new WarconError(`${path}: ${timedOut ? `no answer in ${timeoutMs} ms` : 'Warcon unreachable'}`, timedOut ? 'timeout' : 'unreachable', null, path);
    }
    if (!res.ok) {
      throw new WarconError(`${path}: Warcon answered HTTP ${res.status}`, KIND_OF[res.status] ?? 'http', res.status, path);
    }
    return res;
  }

  return {
    async json(path, schema) {
      const res = await request(path, 'application/json');
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        throw new WarconError(`${path}: expected JSON, got ${res.headers.get('content-type') ?? 'nothing'}`, 'http', res.status, path);
      }
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        const where = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new WarconError(`${path}: unexpected answer (${where})`, 'schema', res.status, path);
      }
      return parsed.data;
    },
    async text(path) {
      return (await request(path, 'text/csv')).text();
    },
  };
}
