import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, safe } from '@/components/section';
import { Container, Empty, PageHeader, Panel, RankCell, Segmented } from '@/components/ui';
import { clanSlug } from '@/lib/clans';
import { ago, duration, int, kd, pct } from '@/lib/format';
import { clans } from '@/lib/server/data';
import { CLAN_SORT_LABELS, CLAN_SORTS, clanValue, MIN_CLAN_SIZE, parseClanSort, type Clan, type ClanSort } from '@/lib/server/clans';
import { parsePeriod, PERIOD_LABELS, PERIODS } from '@/lib/server/views';
import { one, withParams } from '@/lib/url';

export const metadata: Metadata = {
  title: 'Clans',
  description: 'Clans on the TEG WARDOGS servers, ranked by the tag in their players’ names.',
};

const nowSec = () => Math.floor(Date.now() / 1000);

function valueOf(sort: ClanSort, c: Clan): string {
  switch (sort) {
    case 'kd':
      return kd(c.kills, c.deaths);
    case 'perHour':
      return clanValue('perHour', c).toFixed(1);
    case 'winRate':
      return pct(c.wins, c.wins + c.losses + c.draws);
    case 'playtime':
      return duration(c.minutes * 60);
    case 'members':
      return int(c.members.length);
    case 'kills':
      return int(c.kills);
  }
}

export default async function ClansPage({ searchParams }: PageProps<'/clans'>) {
  const sp = await searchParams;
  const sort = parseClanSort(one(sp.sort));
  const period = parsePeriod(one(sp.period), '30d');
  const list = await safe(clans(period, sort));
  const now = nowSec();

  return (
    <>
      <PageHeader
        eyebrow="Rankings"
        title="Clans"
        description={`Players grouped by the clan tag in their in-game name, like [TEG] or (NOR). A tag needs at least ${MIN_CLAN_SIZE} players on the board to count.`}
      >
        <div className="mt-8 flex flex-col gap-3">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Segmented
              label="Stat"
              active={sort}
              items={CLAN_SORTS.map((s) => ({ key: s, label: CLAN_SORT_LABELS[s], href: withParams('/clans', sp, { sort: s === 'kills' ? null : s }) }))}
            />
          </div>
          <Segmented
            label="Period"
            active={period}
            items={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p], href: withParams('/clans', sp, { period: p === '30d' ? null : p }) }))}
          />
        </div>
      </PageHeader>

      <Container className="mt-8">
        <Panel title={`${CLAN_SORT_LABELS[sort]} · ${PERIOD_LABELS[period]}`} action="Players with at least an hour on the servers" flush>
          <Section loaded={list}>
            {(rows) =>
              rows.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-14">Rank</th>
                        <th>Clan</th>
                        <th className="r !text-accent">{CLAN_SORT_LABELS[sort]}</th>
                        {sort !== 'members' && <th className="r">Players</th>}
                        {sort !== 'kills' && <th className="r hidden sm:table-cell">Kills</th>}
                        {sort !== 'kd' && <th className="r hidden md:table-cell">K/D</th>}
                        {sort !== 'winRate' && <th className="r hidden lg:table-cell">Win rate</th>}
                        <th className="r hidden md:table-cell">Top player</th>
                        <th className="r hidden xl:table-cell">Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c, i) => (
                        <tr key={c.tag}>
                          <td>
                            <RankCell rank={i + 1} />
                          </td>
                          <td>
                            <Link href={withParams(`/clans/${clanSlug(c.tag)}`, {}, { period: period === '30d' ? null : period })} className="link font-display text-base font-bold tracking-[0.06em]">
                              [{c.tag}]
                            </Link>
                          </td>
                          <td className="r font-display text-base font-bold text-text">{valueOf(sort, c)}</td>
                          {sort !== 'members' && <td className="r text-muted">{int(c.members.length)}</td>}
                          {sort !== 'kills' && <td className="r hidden text-muted sm:table-cell">{int(c.kills)}</td>}
                          {sort !== 'kd' && <td className="r hidden text-muted md:table-cell">{kd(c.kills, c.deaths)}</td>}
                          {sort !== 'winRate' && <td className="r hidden text-muted lg:table-cell">{pct(c.wins, c.wins + c.losses + c.draws)}</td>}
                          <td className="r hidden max-w-48 truncate text-muted md:table-cell">{c.members[0]?.name}</td>
                          <td className="r hidden text-dim xl:table-cell">{c.lastSeen ? ago(c.lastSeen, now) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No clans on this board yet.</Empty>
              )
            }
          </Section>
        </Panel>
      </Container>
    </>
  );
}
