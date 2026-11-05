import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Section, safe } from '@/components/section';
import { Badge, buttonClass, Container, Empty, FactionTag, PageHeader, Panel } from '@/components/ui';
import { clanTag } from '@/lib/clans';
import { ago, int } from '@/lib/format';
import { fresh } from '@/lib/rating';
import { currentAdmin } from '@/lib/server/accounts/admin';
import type { BalanceMove, BalanceRun } from '@/lib/server/accounts/store';
import { getServers } from '@/lib/server/data';
import { ratings } from '@/lib/server/history';
import { chances, GAP, STACK } from '@/lib/server/teambalance/plan';
import { DEFAULT_MESSAGE } from '@/lib/server/teambalance/run';
import { one } from '@/lib/url';
import { AdminNav } from '../nav';
import { armBalancer, cancelBalancer } from './actions';

// Staff only, like /admin: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Team balancer', robots: { index: false, follow: false } };

const DONE: Record<string, string> = {
  armed: 'Armed. It starts when the next match does.',
  busy: 'That server already has a balancer armed or running. Cancel it first.',
  cancelled: 'Cancelled.',
  unconfirmed: 'Tick the box to confirm live moves.',
};
const STATUS_TONE = { armed: 'accent', running: 'good', done: 'default', cancelled: 'default' } as const;
const pctOf = (n: number) => `${Math.round(n * 100)}%`;

function Help({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <p className={flush ? 'border-b border-line px-4 py-3 text-sm text-muted' : 'mb-4 max-w-3xl text-sm text-muted'}>{children}</p>;
}

function RunSummary({ run, server, moves }: { run: BalanceRun; server: string; moves: BalanceMove[] }) {
  const failed = moves.filter((m) => m.error).length;
  return (
    <details>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
        <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
        <Badge tone={run.mode === 'live' ? 'bad' : 'default'}>{run.mode === 'live' ? 'Live' : 'Watch-only'}</Badge>
        <span className="font-medium">{server}</span>
        <span className="text-xs text-muted">
          armed {ago(run.armedAt)} by {run.armedByName ?? run.armedBy}
          {run.startedAt && ` · match began ${ago(run.startedAt)}`} · {int(moves.length)} {run.mode === 'live' ? 'moved' : 'would move'}
          {failed > 0 && ` · ${failed} failed`}
          {run.note && ` · ${run.note}`}
        </span>
      </summary>
      <div className="border-t border-line bg-surface-2/40">
        {moves.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  {['When', 'Player', 'From', 'To', 'Why', 'Win-chance gap', 'Result'].map((h) => (
                    <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {moves.map((m) => (
                  <tr key={m.steamId}>
                    <td className="px-4 py-2 whitespace-nowrap">{ago(m.at)}</td>
                    <td className="max-w-48 truncate px-4 py-2">
                      <Link prefetch={false} href={`/players/${m.steamId}`} className="link">{m.name}</Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap"><FactionTag name={m.from} /></td>
                    <td className="px-4 py-2 whitespace-nowrap"><FactionTag name={m.to} /></td>
                    <td className="px-4 py-2">{m.kind === 'start' ? 'Start sort' : 'Joined'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{pctOf(m.before)} → {pctOf(m.after)}</td>
                    <td className="px-4 py-2">{m.error ? <span className="text-bad">{m.error}</span> : m.sent ? 'Moved' : run.mode === 'live' ? 'Sending…' : 'Not sent (watch-only)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{run.status === 'armed' ? 'Waiting for the next match to start.' : 'No moves: the sides were already even enough.'}</Empty>
        )}
      </div>
    </details>
  );
}

export default async function TeamBalancePage({ searchParams }: PageProps<'/admin/teambalance'>) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { store } = gate.a;
  const done = DONE[one((await searchParams).done) ?? ''];
  const canMove = !!(process.env.WARCON_MOVE_TOKEN ?? '').trim();
  const found = await safe(getServers({ unmasked: true }));
  const rated = ratings();
  const runs = store.balanceRuns(30);
  const active = store.activeBalanceRuns();

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Team balancer"
        description="Arm it on a server and it evens the sides by skill rating when the next match starts, then places each player who joins. Nobody is moved more than once a game."
      />
      <Container className="mt-8 space-y-4">
        <AdminNav active="teambalance" />
        {done && (
          <p role="status" className="rounded-2xl border-[3px] border-edge bg-surface-2 px-4 py-3 text-sm">{done}</p>
        )}
        {!canMove && (
          <p role="status" className="rounded-2xl border-[3px] border-edge bg-surface-2 px-4 py-3 text-sm text-muted">
            Watch-only for now: the site has no Warcon key that may move players (<code>WARCON_MOVE_TOKEN</code>). Watch-only runs work;
            a live run would be cancelled when its match starts.
          </p>
        )}
        <Panel title="How it works">
          <Help>
            <strong>Arm</strong> it on a server and it does nothing until the <strong>next</strong> match starts, never one already being
            played. Then it sorts whoever is on with the fewest moves that bring each side&apos;s chance of winning (from everyone&apos;s
            skill rating) closest together. After that, each player who joins is weighed up once as they arrive and moved if
            another side needs them more. Player counts never end up more than {GAP} apart. Clan mates {STACK} or more strong on one
            side count as stronger than their ratings, so a big stack is more likely to be split. A moved player is killed so they
            respawn on the new side, and gets your whisper. Nobody is moved twice in a game; it stops when that match ends.
          </Help>
          <Help>
            <strong>Watch-only</strong> works out and logs every move it would make, and moves nobody: run it on a match or two and
            check the log below before arming live. Players without a rating yet count as average.
          </Help>
        </Panel>

        <Section loaded={found}>
          {(servers) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {servers.map((s) => {
                const run = active.find((r) => r.serverId === s.id);
                const factions = (s.status?.factionScores ?? []).map((f) => f.name);
                const sides = new Map(factions.map((f) => [f, s.players.filter((p) => p.faction === f).map((p) => p.steamId)]));
                const odds = factions.length > 1 ? chances(sides, (id) => rated?.get(id)?.skill ?? fresh(), (id) => clanTag(s.players.find((p) => p.steamId === id)?.name ?? '')) : null;
                return (
                  <Panel key={s.id} title={s.shortName} action={s.status ? `${s.status.map} · ${int(s.playerCount)} on${s.startedAt ? ` · match began ${ago(s.startedAt)}` : ''}` : 'No live data'}>
                    {odds && s.players.length > 0 ? (
                      <ul className="mb-4 space-y-1 text-sm tabular-nums">
                        {factions.map((f) => (
                          <li key={f} className="flex items-center justify-between gap-3">
                            <FactionTag name={f} />
                            <span className="text-muted">
                              {int(sides.get(f)!.length)} players · <span className="text-text">{pctOf(odds.get(f)!)}</span> to win by ratings
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mb-4 text-sm text-muted">Nobody on right now.</p>
                    )}
                    {run ? (
                      <form action={cancelBalancer} className="flex flex-wrap items-center gap-3">
                        <input type="hidden" name="runId" value={run.id} />
                        <Badge tone={STATUS_TONE[run.status]}>{run.status === 'armed' ? 'Armed for next match' : 'Balancing this match'}</Badge>
                        <Badge tone={run.mode === 'live' ? 'bad' : 'default'}>{run.mode === 'live' ? 'Live' : 'Watch-only'}</Badge>
                        <button className={buttonClass('secondary')}>Cancel</button>
                      </form>
                    ) : (
                      <form action={armBalancer} className="space-y-3 text-sm">
                        <input type="hidden" name="serverId" value={s.id} />
                        <fieldset className="flex flex-wrap gap-4">
                          <legend className="sr-only">Mode</legend>
                          <label className="flex items-center gap-2">
                            <input type="radio" name="mode" value="watch" defaultChecked /> Watch-only
                          </label>
                          <label className={canMove ? 'flex items-center gap-2' : 'flex items-center gap-2 text-dim'}>
                            <input type="radio" name="mode" value="live" disabled={!canMove} /> Live (moves players)
                          </label>
                        </fieldset>
                        <label className="block">
                          <span className="text-xs text-muted">Whisper to a moved player ({'{team}'} is their new side; empty sends nothing)</span>
                          <input
                            name="message"
                            defaultValue={DEFAULT_MESSAGE}
                            maxLength={200}
                            className="mt-1 w-full rounded-2xl border-[3px] border-edge bg-surface-2 px-2 py-1 outline-none focus:border-accent"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          {canMove && (
                            <label className="flex items-center gap-2 text-muted">
                              <input type="checkbox" name="confirm" value="yes" /> I mean live moves
                            </label>
                          )}
                          <button className={buttonClass('primary')}>Arm for next match</button>
                        </div>
                      </form>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}
        </Section>

        <Panel title="Runs" flush action="Newest first · open one for its moves">
          <Help flush>
            Each run and every move it made, or would have made in watch-only. The win-chance gap is between the likeliest and least
            likely side to win, before and after the move: lower is fairer, 0% is perfectly even.
          </Help>
          {runs.length ? (
            <ul className="divide-y divide-line">
              {runs.map((r) => (
                <li key={r.id}>
                  <RunSummary run={r} server={found instanceof Error ? r.serverId : (found.data.find((s) => s.id === r.serverId)?.shortName ?? r.serverId)} moves={store.balanceMoves(r.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No runs yet.</Empty>
          )}
        </Panel>
      </Container>
    </>
  );
}
