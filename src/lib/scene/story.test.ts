import { describe, expect, it } from 'vitest';
import { advance, BURN_S, FALL_S, FLY_S, type Story } from './story';

const quiet = { missileHit: false };

describe('the crash loop', () => {
  it('fires once the helicopter has circled for a while', () => {
    expect(advance({ phase: 'fly', t: 0 }, FLY_S + 0.01, quiet).phase).toBe('missile');
    expect(advance({ phase: 'fly', t: 0 }, FLY_S - 0.01, quiet)).toEqual({ phase: 'fly', t: FLY_S - 0.01 });
  });

  it('keeps chasing until the missile hits', () => {
    expect(advance({ phase: 'missile', t: 0 }, 60, quiet).phase).toBe('missile');
    expect(advance({ phase: 'missile', t: 2 }, 0.1, { missileHit: true })).toEqual({ phase: 'falling', t: 0 });
  });

  it('falls, burns, then starts again', () => {
    const burning: Story = advance({ phase: 'falling', t: 0 }, FALL_S + 0.01, quiet);
    expect(burning).toEqual({ phase: 'burning', t: 0 });
    expect(advance(burning, BURN_S + 0.01, quiet)).toEqual({ phase: 'fly', t: 0 });
  });
});
