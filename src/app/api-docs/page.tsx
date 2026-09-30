import type { Metadata } from 'next';
import { Container, PageHeader, Panel } from '@/components/ui';

export const metadata: Metadata = { title: 'Public API' };

const ENDPOINTS = [
  {
    path: '/api/servers',
    about: 'Live status of every server: map, population, faction scores, join code and the connected player list.',
    example: '/api/servers',
  },
  {
    path: '/api/leaderboard',
    about:
      'A leaderboard page. metric: kills | kd | kph | headshots | hsr | longest | playtime. period: today | 7d | 30d | all. Optional server, limit (≤100), offset.',
    example: '/api/leaderboard?metric=kd&period=7d&limit=10',
  },
  {
    path: '/api/players/{steamId}',
    about: 'All-time and 7-day totals, ranks, favourite weapons and whether the player is online now.',
    example: '/api/players/76561198000000000',
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
