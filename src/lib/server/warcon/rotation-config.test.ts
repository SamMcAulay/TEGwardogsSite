import { describe, expect, test, vi } from 'vitest';
import { rotationConfig, rotationLines, withRotation } from './rotation-config';

const SAB = '(Map="Russia",Experiences="Moscow_KOTH_01+KOTH_LimitedGear",Lighting="DayClear")';
const RAIN = '(Map="Russia",Experiences="Moscow_KOTH_01+KOTH_LimitedGear",Lighting="DayLateRain")';
const BAK = '(Map="Kavkazi",Experiences="Bakurani_KOTH_02+KOTH_LimitedGear",Lighting="DayClear")';
const DOC = [
  '[/Script/WDGame.WDServerSettings]',
  'ServerName=EU',
  '[/Script/WDGame.WDServerMapRotationSettings]',
  'bEnabled=True',
  'RotationMode=Ordered',
  '!RotationEntries=ClearArray',
  `.RotationEntries=${SAB}`,
  `.RotationEntries=${RAIN}`,
  '[/Script/WDGame.Other]',
  'X=1',
].join('\r\n');

describe('rotation in the config document', () => {
  test('reads the rotation lines', () => {
    expect(rotationLines(DOC)).toEqual([SAB, RAIN]);
    expect(rotationLines('[/Script/WDGame.WDServerSettings]\nA=1')).toBeNull();
  });

  test('replaces only the rotation lines', () => {
    const out = withRotation(DOC, [BAK, BAK])!;
    expect(rotationLines(out)).toEqual([BAK, BAK]);
    expect(out).toContain('ServerName=EU');
    expect(out).toContain('RotationMode=Ordered');
    expect(out).toContain('[/Script/WDGame.Other]\r\nX=1');
    expect(out).not.toContain('Russia');
  });

  test('a rotation section at the end of the file', () => {
    const doc = `[/Script/WDGame.WDServerMapRotationSettings]\n!RotationEntries=ClearArray\n.RotationEntries=${SAB}`;
    expect(rotationLines(withRotation(doc, [BAK])!)).toEqual([BAK]);
  });
});

describe('rotationConfig', () => {
  const reply = (result: unknown, status = 200) => new Response(JSON.stringify({ ok: status === 200, result }), { status });

  test('no key: null', () => {
    expect(rotationConfig('http://w', ' ')).toBeNull();
  });

  test('writes with the revision read, then checks the live rotation', async () => {
    const doFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const action = String(url).split('/').pop();
      if (action === 'config') return reply({ text: DOC, revision: 'r1', writable: true });
      if (action === 'configApply') {
        const body = JSON.parse(String(init?.body));
        expect(body.revision).toBe('r1');
        expect(rotationLines(body.text)).toEqual([BAK, BAK]);
        return reply({ ok: true });
      }
      return reply({ enabled: true, entries: [{ map: 'Kavkazi', lighting: 'DayClear' }, { map: 'Kavkazi', lighting: 'DayClear' }] });
    });
    await rotationConfig('http://w', 'k', doFetch as typeof fetch)!.write('s1', [BAK, BAK]);
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(String(doFetch.mock.calls[0][0])).toBe('http://w/api/servers/s1/rcon/config');
  });

  test('a server still showing the old rotation is an error', async () => {
    const doFetch = vi.fn(async (url: string | URL | Request) => {
      const action = String(url).split('/').pop();
      if (action === 'config') return reply({ text: DOC, revision: 'r1', writable: true });
      if (action === 'configApply') return reply({ ok: true });
      return reply({ enabled: true, entries: [{ map: 'Russia', lighting: 'DayClear' }] });
    });
    await expect(rotationConfig('http://w', 'k', doFetch as typeof fetch)!.write('s1', [BAK, BAK])).rejects.toThrow(/still shows russia\/dayclear/);
  });

  test('a revision conflict is tried once more', async () => {
    let applies = 0;
    const doFetch = vi.fn(async (url: string | URL | Request) => {
      const action = String(url).split('/').pop();
      if (action === 'config') return reply({ text: DOC, revision: `r${applies}`, writable: true });
      if (action === 'configApply') return reply(applies++ ? { ok: true } : { ok: false, conflict: true });
      return reply({ enabled: true, entries: [{ map: 'Kavkazi', lighting: 'DayClear' }] });
    });
    await rotationConfig('http://w', 'k', doFetch as typeof fetch)!.write('s1', [BAK]);
    expect(applies).toBe(2);
  });

  test('a refused key says so', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Missing capability config.apply' }), { status: 403 }));
    await expect(rotationConfig('http://w', 'k', doFetch as typeof fetch)!.read('s1')).rejects.toThrow('config: Warcon answered HTTP 403: Missing capability config.apply');
  });
});
