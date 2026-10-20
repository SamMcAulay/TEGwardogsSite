import { describe, expect, test } from 'vitest';
import { csvCell, linksCsv, linksXlsx } from './export';
import type { Link } from './store';

const link = (o: Partial<Link>): Link => ({
  discordId: '111111111111111111',
  steamId: '76561198000000001',
  tier: null,
  checkedAt: null,
  discordName: null,
  nameStyle: null,
  bio: null,
  colour: null,
  featured: [],
  linkedAt: 1_760_000_000,
  ...o,
});

describe('linked-accounts CSV', () => {
  test('one row per link with tier label and ISO dates', () => {
    const csv = linksCsv(
      [link({ tier: 2, discordName: 'Bob', checkedAt: 1_760_000_600 }), link({ discordId: '2', steamId: '3' })],
      (id) => (id === '76561198000000001' ? 'BobInGame' : null),
    );
    expect(csv.split('\r\n')).toEqual([
      'discord_id,discord_name,steam_id,player_name,tier,tier_label,linked_at,roles_checked_at',
      '111111111111111111,Bob,76561198000000001,BobInGame,2,Premium,2025-10-09T08:53:20.000Z,2025-10-09T09:03:20.000Z',
      '2,,3,,,,2025-10-09T08:53:20.000Z,',
      '',
    ]);
  });

  test('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(3)).toBe('3');
    expect(csvCell(null)).toBe('');
  });

  test('a name a spreadsheet would run as a formula is written as text', () => {
    for (const bad of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx'])
      expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('=1,2')).toBe(`"'=1,2"`);
    expect(csvCell('Bob=1')).toBe('Bob=1');
  });

  test('the Excel file keeps ids as text and shows readable UTC dates', () => {
    const buf = Buffer.from(
      linksXlsx([link({ tier: 1, discordName: 'Sam', checkedAt: 1_760_000_600 })], () => 'SamInGame'),
    );
    const text = buf.toString('latin1');
    expect(text).toContain('<t xml:space="preserve">111111111111111111</t>');
    expect(text).toContain('<t xml:space="preserve">76561198000000001</t>');
    expect(text).toContain('<t xml:space="preserve">2025-10-09 08:53 UTC</t>');
    expect(text).toContain('<t xml:space="preserve">Admin</t>');
  });
});
