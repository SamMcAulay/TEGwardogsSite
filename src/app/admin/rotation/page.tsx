import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Section, safe } from '@/components/section';
import { Badge, buttonClass, Container, PageHeader, Panel } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { lightingName } from '@/lib/game';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { getServers } from '@/lib/server/data';
import { AHEAD, chances, entryOf, LEAN, POOL, scoresOf, START, STEP } from '@/lib/server/rotation/pool';
import { one } from '@/lib/url';
import { AdminNav } from '../nav';
import { switchRotation } from './actions';

// Staff only, like /admin: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Map rotation', robots: { index: false, follow: false } };

const DONE: Record<string, string> = {
  on: 'Switched on. The next map is picked within 15 seconds.',
  off: 'Switched off, and the rotation it had before is back on the server.',
  nokey: 'The site has no Warcon key that may change the rotation (WARCON_ROTATION_TOKEN).',
  readfailed: "Couldn't read the server's rotation from Warcon, so nothing changed. Try again in a minute.",
  restorefailed: "Switched off, but the rotation it had before couldn't be put back. Set the rotation in Warcon's Rotation tab.",
};
const pct = (n: number) => (n >= 0.995 ? '99%' : n > 0 && n < 0.01 ? '<1%' : `${Math.round(n * 100)}%`);
const score = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
const KIND_NAME = { clear: 'Clear', morning: 'Early morning', rain: 'Rain' } as const;

function Help({ children }: { children: ReactNode }) {
  return <p className="mb-3 max-w-3xl text-sm text-muted last:mb-0">{children}</p>;
}

export default async function RotationPage({ searchParams }: PageProps<'/admin/rotation'>) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { store } = gate.a;
  const done = DONE[one((await searchParams).done) ?? ''];
  const canWrite = !!(process.env.WARCON_ROTATION_TOKEN ?? '').trim();
  const found = await safe(getServers({ unmasked: true }));

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Map rotation"
        description="A weighted map rotation: each server picks its next map at random, leaning hard towards the maps it has played least."
      />
      <Container className="mt-8 space-y-4">
        <AdminNav active="rotation" />
        {done && <p role="status" className="border border-surface-3 bg-surface-2 px-4 py-3 text-sm">{done}</p>}
        {!canWrite && (
          <p role="status" className="border border-surface-3 bg-surface-2 px-4 py-3 text-sm text-muted">
            Off for now: the site has no Warcon key that may change the rotation (<code>WARCON_ROTATION_TOKEN</code>).
          </p>
        )}

        <Panel title="Why not a normal rotation?">
          <Help>
            A fixed rotation plays its maps in the same order every time. Each time a server seeded, it started from the top of the
            list again, so players saw the same few maps over and over. A server that emptied or restarted before getting through
            all 9 maps never reached the end of the list, so some maps were hardly ever played.
          </Help>
          <Help>
            The weighted rotation remembers what each server has played and keeps choosing the maps it has played least, so every
            map and time of day keeps coming round, however the server&apos;s day goes.
          </Help>
        </Panel>

        <Panel title="How it works">
          <Help>
            Every map and time of day has a <strong>score</strong>. Each time one is played, its score goes up: clear by{' '}
            {STEP.clear}, early morning by {STEP.morning}, rain by {STEP.rain}. New scores start at {START.clear},{' '}
            {START.morning} and {START.rain}. When a match starts, the next map is drawn at random, but lower scores are much
            more likely: one point lower is about {Math.round(Math.exp(LEAN))}× as likely. So the least-played map is the
            favourite but never certain. The map being played is never picked to come next, so the same map never comes up twice
            in a row. The site plans {AHEAD} maps ahead (shown on the server page), drawing each as if the ones before it had
            been played; if a server loads anything other than the planned map, the plan is drawn again. Rain starts higher and climbs faster, so over time it is about 41% clear, 32% early morning and 27% rain.
            Each server keeps its own scores. Sabatulo has no early-morning lighting in the game, so it uses clear late afternoon in its place, with the same odds.
          </Help>
          <Help>
            <strong>How it reaches the server:</strong> as soon as a match starts, the site writes its pick into the server&apos;s
            rotation (in the config), so the server goes to it when the round ends. Warcon&apos;s Rotation tab shows the pick
            listed twice; that is expected, and it is also why a server that restarts starts on the pick. If you edit the rotation in Warcon while this is on, your edit only lasts until the
            next match starts, when the site writes its next pick. To play something else, switch it off first. Switching it off
            puts back the rotation the server had before it was switched on.
          </Help>
        </Panel>

        <Section loaded={found}>
          {(servers) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {servers.map((s) => {
                const state = store.rotationServer(s.id);
                const on = !!state?.enabled;
                const scores = scoresOf(store.rotationScores(s.id));
                const playing = entryOf(s.status?.map, s.status?.lighting)?.map ?? s.status?.map ?? null;
                const odds = chances(scores, playing);
                const rows = [...POOL].sort((a, b) => (odds.get(b.key) ?? 0) - (odds.get(a.key) ?? 0) || scores.get(a.key)! - scores.get(b.key)!);
                const next = state?.nextKey ? entryOf(...(state.nextKey.split('/') as [string, string])) : null;
                return (
                  <Panel key={s.id} title={s.shortName} action={s.status ? `${s.status.map} · ${int(s.playerCount)} on` : 'No live data'}>
                    <form action={switchRotation} className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                      <input type="hidden" name="serverId" value={s.id} />
                      <input type="hidden" name="on" value={on ? 'no' : 'yes'} />
                      <Badge tone={on ? 'good' : 'default'}>{on ? 'On' : 'Off'}</Badge>
                      <button className={buttonClass(on ? 'secondary' : 'primary')} disabled={!canWrite}>
                        {on ? 'Switch off' : 'Switch on'}
                      </button>
                      {state?.changedAt && (
                        <span className="text-xs text-muted">
                          switched {on ? 'on' : 'off'} {ago(state.changedAt)}
                          {state.changedBy && ` by ${state.changedBy}`}
                        </span>
                      )}
                    </form>
                    {on && (
                      <p className="mb-4 text-sm">
                        {next ? (
                          <>
                            Up next: <strong>{next.map}</strong>, {lightingName(next.lighting)}
                            {!state!.written && <span className="text-muted"> (not on the server yet; retrying)</span>}
                            {state!.later.length > 0 && (
                              <span className="text-muted">
                                {' '}· then {state!.later.map((k) => k.replace('/', ', ').replace(/Day\w+$/, (l) => lightingName(l))).join(' → ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">Picks the next map when it sees the match being played.</span>
                        )}
                      </p>
                    )}
                    {on && state?.note && <p className="mb-4 border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-bad">{state.note}</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm tabular-nums">
                        <thead className="text-left text-xs text-muted">
                          <tr>
                            {['Map', 'Time of day', 'Score', 'Chance next'].map((h) => (
                              <th key={h} className="py-1 pr-3 font-normal whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {rows.map((e) => (
                            <tr key={e.key} className={e.key === next?.key && on ? 'text-accent' : undefined}>
                              <td className="py-1 pr-3">{e.map}</td>
                              <td className="py-1 pr-3">{KIND_NAME[e.kind]}</td>
                              <td className="py-1 pr-3">{score(scores.get(e.key)!)}</td>
                              <td className="py-1 pr-3">{odds.has(e.key) ? pct(odds.get(e.key)!) : <span className="text-muted">playing now</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </Section>
      </Container>
    </>
  );
}
