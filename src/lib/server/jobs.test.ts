import { beforeEach, describe, expect, test } from 'vitest';
import { jobRan, jobState, resetJobs } from './jobs';

describe('job states', () => {
  beforeEach(() => resetJobs());

  test('nothing until a pass finishes', () => {
    expect(jobState('warmer')).toBeNull();
  });

  test('a failed pass keeps the time of the last good one', () => {
    jobRan('rounds', { note: 'posted 1' }, 100);
    jobRan('rounds', { error: 'bot cannot post' }, 220);
    expect(jobState('rounds')).toEqual({ lastRun: 220, lastOk: 100, error: 'bot cannot post', note: null });
    jobRan('rounds', {}, 340);
    expect(jobState('rounds')).toEqual({ lastRun: 340, lastOk: 340, error: null, note: null });
  });

  test('a failure with no good pass before it', () => {
    jobRan('tierSync', { error: 'rate limited' }, 50);
    expect(jobState('tierSync')?.lastOk).toBeNull();
  });
});
