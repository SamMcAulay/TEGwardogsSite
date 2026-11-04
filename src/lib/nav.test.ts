import { describe, expect, it } from 'vitest';
import { activeTab, youItems } from './nav';

describe('activeTab', () => {
  it('puts live pages under Live', () => {
    expect(activeTab('/')).toBe('live');
    expect(activeTab('/servers/eu1')).toBe('live');
    expect(activeTab('/matches/1/2')).toBe('live');
    expect(activeTab('/feed')).toBe('live');
  });

  it('puts boards under Stats', () => {
    expect(activeTab('/skill')).toBe('stats');
    expect(activeTab('/clans/abc')).toBe('stats');
    expect(activeTab('/records')).toBe('stats');
  });

  it('puts players and compare under Players', () => {
    expect(activeTab('/compare')).toBe('players');
    expect(activeTab('/players/7656')).toBe('players');
  });

  it('puts the account and friends under You', () => {
    expect(activeTab('/account')).toBe('you');
    expect(activeTab('/friends')).toBe('you');
  });

  it('leaves everything else unhighlighted', () => {
    expect(activeTab('/admin')).toBeNull();
    expect(activeTab('/api-docs')).toBeNull();
    expect(activeTab('/serversx')).toBeNull();
  });
});

describe('youItems', () => {
  it('offers sign in to visitors', () => {
    expect(youItems(null)).toEqual([{ label: 'Sign in', href: '/account' }]);
  });

  it('leads with the profile once Steam is linked', () => {
    expect(youItems({ steamId: '1' }).map((i) => i.href)).toEqual(['/players/1', '/friends', '/account']);
  });

  it('keeps account settings reachable without Steam', () => {
    expect(youItems({ steamId: null }).map((i) => i.href)).toEqual(['/account', '/friends']);
  });
});
