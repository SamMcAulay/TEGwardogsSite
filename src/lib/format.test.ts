import { describe, expect, it, test } from 'vitest';
import { ago, date, dateTime, dayMonth, duration, hourMinute, kd, metres, ordinal, pct } from './format';
import { causeInfo, killContexts, mapName } from './game';

describe('format', () => {
  it('formats durations', () => {
    expect(duration(45)).toBe('45s');
    expect(duration(125)).toBe('2m');
    expect(duration(3 * 3600 + 720)).toBe('3h 12m');
    expect(duration(2 * 86400 + 3600)).toBe('2d 1h');
  });
  it('formats ratios and distances', () => {
    expect(kd(10, 4)).toBe('2.50');
    expect(kd(7, 0)).toBe('7.00');
    expect(pct(1, 3)).toBe('33.3%');
    expect(metres(812.4)).toBe('812 m');
    expect(metres(1234)).toBe('1.23 km');
  });
  it('formats relative times and ordinals', () => {
    expect(ago(1000, 1010)).toBe('just now');
    expect(ago(1000, 1000 + 7200)).toBe('2h ago');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 102].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '102nd',
    ]);
  });
});

describe('game vocabulary', () => {
  it('names maps and causes', () => {
    expect(mapName('Kavkazi')).toBe('Bakurani');
    expect(causeInfo('Id.Item.AK74M')).toEqual({ label: 'AK-74M', kind: 'weapon' });
    expect(causeInfo('ID.ITEM.ak74m').label).toBe('AK-74M');
    expect(causeInfo('Id.Vehicle.WeaponExtension.XYZ_09.BigGun')).toEqual({ label: 'Big Gun', kind: 'vehicle weapon' });
    expect(causeInfo(undefined).label).toBe('Environment');
  });
  it('extracts kill context tags', () => {
    expect(
      killContexts([
        'Meta.Progression.Context.Player.KillContext.Headshot',
        'Meta.PlayerKillFlag.Player.Local.Kill',
        'Meta.PlayerKillFlag.Player.Suicide',
      ]),
    ).toEqual(['Headshot', 'Suicide']);
  });
});

describe('dates in a timezone', () => {
  // 14 Sep 2026, 23:30 UTC
  const ts = Date.UTC(2026, 8, 14, 23, 30) / 1000;
  test('UTC by default, as before', () => {
    expect(date(ts)).toBe('14 Sep 2026');
    expect(dateTime(ts)).toBe('14 Sep, 23:30 UTC');
    expect(hourMinute(ts)).toBe('23:30');
    expect(dayMonth(ts)).toBe('14/9');
  });
  test('another timezone shifts the clock and, past midnight, the date', () => {
    expect(dateTime(ts, 'Europe/London')).toBe('15 Sep, 00:30');
    expect(date(ts, 'Europe/London')).toBe('15 Sep 2026');
    expect(dateTime(ts, 'America/Los_Angeles')).toBe('14 Sep, 16:30');
    expect(dayMonth(ts, 'Asia/Tokyo')).toBe('15/9');
    expect(hourMinute(Date.UTC(2026, 0, 1, 0, 5) / 1000, 'Europe/Berlin')).toBe('01:05');
  });
});
