import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Section, safe } from '@/components/section';
import { Container, PageHeader, Panel, Stat, StatGrid, StatusDot } from '@/components/ui';
import { ago, duration, int } from '@/lib/format';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { TIER_MAX_AGE } from '@/lib/server/accounts/sync';
import { getServers, killFeeds } from '@/lib/server/data';
import { warconHealth, type WarconState } from '@/lib/server/health';
import { jobState, type JobName } from '@/lib/server/jobs';
import { AdminNav } from '../nav';

// Staff only, like /admin: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Site health', robots: { index: false, follow: false } };

const WARCON: Record<WarconState, { text: string; good: boolean }> = {
  ok: { text: 'Answering', good: true },
  key_rejected: { text: 'Our API key was rejected', good: false },
  key_lacks_view: { text: 'Our API key lacks view access', good: false },
  unreachable: { text: 'Not reachable', good: false },
  error: { text: 'Answered with an error', good: false },
};

/** A kill feed this quiet while this many people play is probably broken. */
const FEED_QUIET_S = 30 * 60;
const FEED_BUSY_PLAYERS = 10;

/** Each job's pass interval, and whether it runs at all here. */
const JOBS: { name: JobName; label: string; everyS: number; what: string }[] = [
  { name: 'warmer', label: 'Page warmer', everyS: 60, what: 'Keeps the busiest pages loaded from Warcon' },
  { name: 'history', label: 'History', everyS: 300, what: 'Stores finished rounds (trends, skill ratings) and the daily board snapshot' },
  { name: 'tierSync', label: 'Tier sync', everyS: 120, what: 'Re-checks linked members’ Discord roles' },
  { name: 'rounds', label: 'Round poster', everyS: 120, what: 'Posts finished rounds to Discord' },
  { name: 'alerts', label: 'Alerts', everyS: 60, what: 'Sends /notify DMs when servers fill up or maps start' },
];

const nowSec = () => Math.floor(Date.now() / 1000);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function Tone({ good, children }: { good: boolean | null; children: ReactNode }) {
  return <span className={good === null ? 'text-muted' : good ? 'text-good' : 'text-bad'}>{children}</span>;
}

export default async function HealthPage() {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { env, store } = gate.a;
  const now = nowSec();
  const [warcon, servers, feeds] = await Promise.all([warconHealth(), safe(getServers()), safe(killFeeds())]);
  const w = WARCON[warcon.state];
  const mem = process.memoryUsage();
  const counts = store.counts();
  const staleTiers = store.due(now - 3 * TIER_MAX_AGE, 100_000).length;
  const dbFile = join(env.dataDir, 'accounts.db');
  const dbBytes = fileSize(dbFile) + fileSize(`${dbFile}-wal`);
  const feedOf = new Map(feeds instanceof Error ? [] : feeds.data.map((f) => [f.serverId, f]));

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Site health"
        description="Whether the site and the things it depends on are working. Checked as this page loads; reload to check again."
      />
      <Container className="mt-8 space-y-4">
        <AdminNav active="health" />

        <StatGrid className="grid-cols-2 sm:grid-cols-4">
          <Stat label="Warcon" value={<Tone good={w.good}>{w.text}</Tone>} />
          <Stat label="Site up for" value={duration(Math.floor(process.uptime()))} />
          <Stat label="Memory (RSS)" value={mb(mem.rss)} />
          <Stat label="Node" value={process.version} />
        </StatGrid>

        <Panel title="Servers" flush action="Live status and kill feed">
          <Section loaded={servers}>
            {(rows) => (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Server</th>
                      <th className="r">Players</th>
                      <th className="r">Warcon last looked</th>
                      <th className="r">Kill feed last sent</th>
                      <th className="r">Newest kill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const f = feedOf.get(s.id);
                      const quiet =
                        !!f && s.playerCount >= FEED_BUSY_PLAYERS && (!f.feedAt || now - f.feedAt > FEED_QUIET_S);
                      return (
                        <tr key={s.id}>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <StatusDot online={s.online} /> {s.shortName}
                            </span>
                          </td>
                          <td className="r">{s.online === null ? '—' : int(s.playerCount)}</td>
                          <td className="r text-muted">{ago(s.updatedAt, now)}</td>
                          <td className="r">
                            {f ? (
                              <Tone good={quiet ? false : null}>
                                {ago(f.feedAt, now)}
                                {quiet && ' · check the feed'}
                              </Tone>
                            ) : (
                              <span className="text-muted">didn’t answer</span>
                            )}
                          </td>
                          <td className="r text-muted">{f ? ago(f.newestKill, now) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Background jobs" flush action="Since the site last started">
            <ul className="divide-y divide-line text-sm">
              {JOBS.map((j) => {
                const on = j.name === 'rounds' ? !!env.roundsChannelId : j.name === 'alerts' ? !!env.discordPublicKey : true;
                const s = jobState(j.name);
                const late = !!s && now - s.lastRun > 3 * j.everyS;
                return (
                  <li key={j.name} className="space-y-1 px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{j.label}</span>
                      {!on ? (
                        <span className="text-muted">Off (not set up here)</span>
                      ) : !s ? (
                        <span className="text-muted">No pass finished yet</span>
                      ) : (
                        <Tone good={!s.error && !late}>
                          {s.error ? 'Failed' : late ? 'Late' : 'OK'} · last ran {ago(s.lastRun, now)}
                        </Tone>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      {j.what}, every {j.everyS / 60} min.
                      {s?.note && ` Last pass: ${s.note}.`}
                    </p>
                    {s?.error && (
                      <p className="break-words text-xs text-bad">
                        {s.error}
                        {s.lastOk ? ` (last OK ${ago(s.lastOk, now)})` : ' (no pass has worked since start)'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Linked accounts database">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">Linked accounts</dt>
              <dd>{int(counts.total)}</dd>
              <dt className="text-muted">Tiers not checked lately</dt>
              <dd>
                <Tone good={staleTiers === 0}>{int(staleTiers)}</Tone>{' '}
                <span className="text-xs text-muted">
                  (older than {(3 * TIER_MAX_AGE) / 60} min; the sync should keep this at 0)
                </span>
              </dd>
              <dt className="text-muted">File size</dt>
              <dd>{mb(dbBytes)}</dd>
            </dl>
          </Panel>
        </div>
      </Container>
    </>
  );
}
