import type { Metadata } from 'next';
import Link from 'next/link';
import { AreaChart } from '@/components/charts';
import { AutoRefresh } from '@/components/client';
import { FactionScores, MapBackdrop } from '@/components/game';
import { Badge, Container, PageHeader, StatusDot } from '@/components/ui';
import { ago, clock, int } from '@/lib/format';
import { lightingName, mapName, REGION_NAMES } from '@/lib/game';
import { nowSec } from '@/lib/server/db';
import { getServers, networkSummary, population } from '@/lib/server/queries';

export const metadata: Metadata = { title: 'Servers' };

export default function ServersPage() {
  const servers = getServers();
  const summary = networkSummary(servers);
  const since = nowSec() - 86400;
  const regions = [...new Set(servers.map((s) => s.region))];

  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        eyebrow={
          <>
            <StatusDot online={summary.serversOnline > 0} /> {summary.serversOnline} of {summary.serversTotal} online
          </>
        }
        title="Servers"
        description="Every TEG WARDOGS server, polled over RCON every few seconds. Population is sampled each minute."
        actions={
          <div className="text-right">
            <div className="display num text-4xl leading-none">
              {int(summary.playersOnline)}
              <span className="text-xl text-dim">/{int(summary.capacity)}</span>
            </div>
            <div className="eyebrow mt-1">Players on the network</div>
          </div>
        }
      />
      <Container className="mt-8 space-y-10">
        {regions.map((region) => (
          <section key={region}>
            <h2 className="eyebrow mb-3">{REGION_NAMES[region] ?? region}</h2>
            <div className="space-y-3">
              {servers
                .filter((s) => s.region === region)
                .map((s) => {
                  const st = s.status;
                  const pop = population(s.id, since, 900);
                  return (
                    <Link
                      key={s.id}
                      href={`/servers/${s.id}`}
                      className="panel group grid overflow-hidden transition-colors hover:border-line-strong md:grid-cols-[280px_1fr_1.2fr]"
                    >
                      <div className="relative min-h-32 overflow-hidden border-b border-line bg-surface-2 p-4 text-accent/50 md:border-r md:border-b-0">
                        <MapBackdrop map={st?.map} className={s.online ? '' : 'opacity-30 grayscale'} />
                        <div className="absolute inset-0 bg-gradient-to-r from-surface-2 via-surface-2/70 to-transparent" />
                        <div className="relative">
                          <div className="flex items-center gap-2">
                            <StatusDot online={s.online} />
                            <span className="eyebrow !text-[0.66rem] !text-text">
                              {s.online ? 'Online' : 'Offline'}
                            </span>
                          </div>
                          <div className="display mt-3 text-3xl leading-none text-text">{s.shortName}</div>
                          <div className="mt-1 text-xs text-muted">{s.location}</div>
                          <div className="mt-3 truncate text-xs text-dim">{s.name}</div>
                        </div>
                      </div>
                      <div className="border-b border-line p-4 md:border-r md:border-b-0">
                        {st ? (
                          <>
                            <div className="mb-3 flex items-baseline justify-between gap-3">
                              <div>
                                <div className="display text-lg leading-none">{mapName(st.map)}</div>
                                <div className="mt-1 text-xs text-muted">
                                  King of the Hill · {lightingName(st.lighting)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="display num text-2xl leading-none">
                                  {s.players.length}
                                  <span className="text-base text-dim">/{st.players.max}</span>
                                </div>
                                {st.matchSeconds != null && (
                                  <div className="num mt-1 text-xs text-muted">{clock(st.matchSeconds)} in</div>
                                )}
                              </div>
                            </div>
                            <FactionScores scores={st.factionScores} compact />
                          </>
                        ) : (
                          <div className="flex h-full flex-col items-start justify-center gap-2 text-sm text-muted">
                            <Badge tone="bad">Unreachable</Badge>
                            {s.lastOnlineAt ? `Last seen ${ago(s.lastOnlineAt)}` : 'No contact yet'}
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="eyebrow mb-1 !text-[0.66rem]">Last 24 hours</div>
                        <AreaChart
                          points={pop.map((p) => ({ t: p.ts, v: p.players }))}
                          capacity={st?.players.max}
                          height={110}
                          unit=" players"
                        />
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        ))}
      </Container>
    </>
  );
}
