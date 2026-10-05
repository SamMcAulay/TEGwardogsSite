import type { Metadata } from 'next';
import { Container, PageHeader, Panel } from '@/components/ui';

export const metadata: Metadata = { title: 'Public API' };

const ENDPOINTS = [
  {
    path: '/api/servers',
    about:
      'Live status of every server. Fields: id, name, shortName, region, online, map, players, maxPlayers, joinCode, updatedAt.',
    example: '/api/servers',
  },
  {
    path: '/api/leaderboard',
    about:
      'A leaderboard page of 50 rows. metric: kills | deaths | kd | perHour | playtime | matches | wins | winRate | cash. period: 7d | 30d | 90d | all. Optional server and page. Returns metric, period, page, total, pageSize and rows (rank, steamId, name, avatarUrl, kills, deaths, headshots, playtime, matches, wins, cash, value, lastSeen).',
    example: '/api/leaderboard?metric=kd&period=30d',
  },
  {
    path: '/api/players/{steamId}',
    about:
      'Fields: steamId, name, avatarUrl, firstSeen, lastSeen, rank, totals, online (serverId or null) and weapons (top 10). 404 for an unknown player.',
    example: '/api/players/76561198000000000',
  },
  {
    path: '/api/health',
    about:
      'Site health: { ok, warcon, servers }. warcon is ok, unreachable, key_rejected, key_lacks_view or error. 503 only when the site is misconfigured.',
    example: '/api/health',
  },
];

export default function ApiDocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Tools"
        title="Public API"
        description="Read-only JSON for Discord bots, overlays and spreadsheets. No key needed; please cache responses and keep it under one request per second."
      />
      <Container className="mt-8 space-y-4">
        {ENDPOINTS.map((e) => (
          <Panel
            key={e.path}
            title={<span className="font-mono text-sm normal-case tracking-normal">GET {e.path}</span>}
          >
            <p className="text-sm text-muted">{e.about}</p>
            <a href={e.example} className="mt-3 inline-block font-mono text-xs text-accent hover:underline">
              {e.example}
            </a>
          </Panel>
        ))}
      </Container>
    </>
  );
}
