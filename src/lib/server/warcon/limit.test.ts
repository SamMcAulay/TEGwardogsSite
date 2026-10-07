import { afterEach, describe, expect, test, vi } from 'vitest';
import { Limiter } from './limit';

const deferred = () => {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  return { promise, resolve };
};

afterEach(() => vi.useRealTimers());

describe('Limiter', () => {
  test('runs at most `max` at once; the rest wait their turn, in order', async () => {
    const lim = new Limiter({ max: 2, maxWaitMs: 30_000, maxQueue: 10 });
    const jobs = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = jobs.map((j, i) => lim.run(() => (started.push(i), j.promise)));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    jobs[0].resolve('a');
    await results[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    jobs[1].resolve('b');
    jobs[2].resolve('c');
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c']);
  });

  test('a failed job frees its slot', async () => {
    const lim = new Limiter({ max: 1, maxWaitMs: 30_000, maxQueue: 10 });
    await expect(lim.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await lim.run(async () => 'ok')).toBe('ok');
  });

  test('waiting too long gives up with a busy error and never runs the job', async () => {
    vi.useFakeTimers();
    const lim = new Limiter({ max: 1, maxWaitMs: 1_000, maxQueue: 10 });
    const hold = deferred();
    void lim.run(() => hold.promise);
    const job = vi.fn(async () => 'late');
    const waiting = lim.run(job);
    const check = expect(waiting).rejects.toMatchObject({ kind: 'busy' });
    await vi.advanceTimersByTimeAsync(1_001);
    await check;
    hold.resolve('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(job).not.toHaveBeenCalled();
  });

  test('a full queue turns new work away at once', async () => {
    const lim = new Limiter({ max: 1, maxWaitMs: 30_000, maxQueue: 1 });
    const hold = deferred();
    void lim.run(() => hold.promise);
    void lim.run(async () => 'queued');
    await expect(lim.run(async () => 'third')).rejects.toMatchObject({ kind: 'busy' });
    hold.resolve('x');
  });
});
