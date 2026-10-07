// Caps how many of Warcon's heaviest queries run at once. A player's record and career each make
// Warcon's database scan every player's sessions; when lots of people look up profiles together,
// running them all at once slows every one past its timeout and takes the panel down with it.
// Queued, they finish one batch at a time, and anyone left waiting too long is told it's busy.
import { WarconError } from './http';

export class Limiter {
  private active = 0;
  private queue: { start: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(private readonly opts: { max: number; maxWaitMs: number; maxQueue: number }) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.opts.max) await this.wait();
    else this.active++;
    try {
      return await job();
    } finally {
      this.release();
    }
  }

  private wait(): Promise<void> {
    if (this.queue.length >= this.opts.maxQueue) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          this.queue = this.queue.filter((e) => e !== entry);
          reject(busy());
        }, this.opts.maxWaitMs),
      };
      this.queue.push(entry);
    });
  }

  /** Hands the slot straight to the next in line, or frees it. */
  private release(): void {
    const next = this.queue.shift();
    if (next) next.start();
    else this.active--;
  }
}

const busy = () => new WarconError('too many player lookups at once', 'busy', null, 'players');
