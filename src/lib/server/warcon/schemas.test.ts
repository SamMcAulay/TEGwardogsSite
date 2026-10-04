import { describe, expect, test } from 'vitest';
import { dossierBody, liveBody, seenBody, serversBody } from './schemas';

describe('schemas are the privacy boundary', () => {
  test('a dossier comes out without risk, watch, bans, lists, notes or actions', () => {
    const raw = {
      ok: true,
      dossier: {
        steamId: '76561198000000001',
        name: 'Alpha',
        names: ['Alpha', 'Old'],
        online: null,
        steamEnabled: true,
        steam: { persona: 'Alpha', avatar: 'https://a/1.jpg', profileUrl: 'x', vacBans: 2, friendsTotal: 9 },
        risk: { level: 'high', reasons: ['vac'] },
        watch: { watched: true, reason: 'aimbot report', updatedByName: 'mod', updatedAt: null },
        bannedOn: [{ serverId: 's', serverName: 'S', reason: 'x', bannedBy: 'mod' }],
        orgServerCount: 6,
        orgLists: { ban: null, reserve: null, canBan: true, canReserve: true },
        summary: { sessions: 3, minutes: 90, kills: 10, deaths: 5, firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z' },
        combat: null,
        perServer: [],
        recent: [{ ip: '203.0.113.9' }],
        notes: [{ body: 'secret' }],
        actions: [{ id: 1 }],
      },
    };
    const out = JSON.stringify(dossierBody.parse(raw));
    for (const word of ['risk', 'watch', 'aimbot', 'bannedOn', 'orgLists', 'notes', 'secret', 'actions', 'vacBans', '203.0.113.9']) {
      expect(out).not.toContain(word);
    }
    expect(dossierBody.parse(raw).dossier.steam).toEqual({ avatar: 'https://a/1.jpg' });
  });

  test('live players come out without ping', () => {
    const out = liveBody.parse({
      ok: true,
      live: {
        serverId: 's',
        ok: true,
        error: '',
        build: '1.2.3',
        gameServerId: 'JOIN1',
        startedAt: null,
        status: {
          serverName: 'S', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 10,
          playerCount: 1, maxPlayers: 64, scores: [{ name: 'Valkyra', colorHex: '#f00', score: 3 }],
        },
        players: [{ name: 'A', steamId: '76561198000000001', faction: 'Valkyra', kills: 1, deaths: 0, cash: 5, ping: 40 }],
        observedAt: '2026-10-04T12:00:00Z',
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/ping|build/);
  });

  test('servers come out without host, port or notes', () => {
    const out = serversBody.parse({ ok: true, servers: [{ id: 's', orgId: 'o', name: 'EU#1 - x', sortOrder: 0, host: '10.0.0.1', port: 7776, notes: 'pw in vault' }] });
    expect(out.servers[0]).toEqual({ id: 's', orgId: 'o', name: 'EU#1 - x', sortOrder: 0 });
  });

  test('seen players come out without banned or watched', () => {
    const out = seenBody.parse({
      ok: true,
      total: 1,
      players: [{ steamId: '76561198000000001', name: 'A', aliases: [], firstSeen: 'x', lastSeen: 'y', minutes: 1, kills: 0, deaths: 0, online: false, lastServerId: 's', banned: 'org', watched: true, steam: null }],
    });
    expect(JSON.stringify(out)).not.toMatch(/banned|watched/);
  });
});
