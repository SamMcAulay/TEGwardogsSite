import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NameTag, TierBadge } from '@/components/tier';
import { isNameStyle, NAME_STYLE_LABELS, NAME_STYLES, nameStyleFor } from '@/lib/name-styles';
import { canCustomise, isProfileColour, PROFILE_COLOURS } from '@/lib/profile-themes';
import { buttonClass, Container, Empty, PageHeader, Panel, Stat, StatGrid } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { currentAdmin, parseLookup } from '@/lib/server/accounts/admin';
import { member } from '@/lib/server/accounts/discord';
import type { AccountsEnv } from '@/lib/server/accounts/env';
import type { Link as AccountLink } from '@/lib/server/accounts/store';
import { playerName } from '@/lib/server/data';
import { one } from '@/lib/url';
import { clearProfile, recheckAccount, setNameStyle, unlinkAccount } from './actions';
import { AdminNav } from './nav';

// Staff only, and linked from nowhere: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

const DONE: Record<string, { text: string; good: boolean }> = {
  styled: { text: 'Name style saved. It shows while they hold a TEG tier.', good: true },
  'bio-cleared': { text: 'Bio removed. They can write a new one.', good: true },
  'profile-reset': { text: 'Custom profile reset: bio, colour and featured badges cleared.', good: true },
  rechecked: { text: 'Roles re-checked with Discord.', good: true },
  unlinked: { text: 'Account unlinked. They can link again from /account.', good: true },
  'discord-down': { text: 'Discord did not answer; the tier was left as it was.', good: false },
  unconfirmed: { text: 'Tick the box to confirm before unlinking.', good: false },
  gone: { text: 'That account is no longer linked.', good: false },
};

const ts = (sec: number | null) => (sec ? dateTime(sec) : '—');

async function LinkCard({ link, env }: { link: AccountLink; env: AccountsEnv }) {
  const [who, name] = await Promise.all([member(env, link.discordId).catch(() => undefined), playerName(link.steamId)]);
  const discordName =
    who === undefined ? `${link.discordName ?? 'Unknown'} (Discord did not answer)` : who === null ? `${link.discordName ?? 'Unknown'} (left the TEG server)` : who.name;
  return (
    <Panel title="Linked account">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted">Discord</dt>
        <dd>
          <span className="font-medium">{discordName}</span>{' '}
          <a href={`https://discord.com/users/${link.discordId}`} target="_blank" rel="noreferrer" className="link font-mono text-xs text-muted">
            {link.discordId} ↗
          </a>
        </dd>
        <dt className="text-muted">Steam</dt>
        <dd>
          <Link prefetch={false} href={`/players/${link.steamId}`} className="link font-medium">
            {name ?? 'Player'}
          </Link>{' '}
          <span className="font-mono text-xs text-muted">{link.steamId}</span>
        </dd>
        <dt className="text-muted">Tier</dt>
        <dd>{link.tier ? <TierBadge tier={link.tier} /> : <span className="text-muted">None</span>}</dd>
        <dt className="text-muted">Linked</dt>
        <dd>{ts(link.linkedAt)}</dd>
        <dt className="text-muted">Roles last checked</dt>
        <dd>{ts(link.checkedAt)}</dd>
        <dt className="text-muted">Custom profile</dt>
        <dd className="space-y-2">
          {link.bio || link.colour || link.featured.length ? (
            <>
              {link.bio && <p className="text-text">&ldquo;{link.bio}&rdquo;</p>}
              <p className="text-xs text-muted">
                Colour: {isProfileColour(link.colour) ? PROFILE_COLOURS[link.colour].label : 'default'} · Featured: {link.featured.length || 'none'}
                {!canCustomise(link.tier) && ' · hidden while they are not Premium or staff'}
              </p>
              <div className="flex flex-wrap gap-2">
                {link.bio && (
                  <form action={clearProfile}>
                    <input type="hidden" name="discordId" value={link.discordId} />
                    <button className={buttonClass('danger')}>Remove bio</button>
                  </form>
                )}
                <form action={clearProfile}>
                  <input type="hidden" name="discordId" value={link.discordId} />
                  <input type="hidden" name="reset" value="yes" />
                  <button className={buttonClass('secondary')}>Reset profile</button>
                </form>
              </div>
            </>
          ) : (
            <span className="text-muted">Not customised</span>
          )}
        </dd>
        <dt className="text-muted">Name style</dt>
        <dd>
          <form action={setNameStyle} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="discordId" value={link.discordId} />
            <select
              name="style"
              defaultValue={isNameStyle(link.nameStyle) ? link.nameStyle : 'default'}
              className="border border-line-strong bg-surface-2 px-2 py-1 text-sm outline-none focus:border-accent"
            >
              <option value="default">Tier default</option>
              {NAME_STYLES.map((s) => (
                <option key={s} value={s}>
                  {NAME_STYLE_LABELS[s]}
                </option>
              ))}
            </select>
            <button className={buttonClass('secondary')}>Save</button>
            <NameTag style={nameStyleFor(link.tier, link.nameStyle)} className="font-display text-lg font-bold">
              {link.discordName ?? 'Preview'}
            </NameTag>
          </form>
        </dd>
      </dl>
      <div className="mt-5 flex flex-wrap items-start gap-3 border-t border-line pt-4">
        <form action={recheckAccount}>
          <input type="hidden" name="discordId" value={link.discordId} />
          <button className={buttonClass('secondary')}>Re-check roles</button>
        </form>
        <form action={unlinkAccount} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="discordId" value={link.discordId} />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="confirm" value="yes" required className="accent-[var(--bad)]" />
            Unlink this Steam account from this Discord account
          </label>
          <button className={buttonClass('danger')}>Unlink</button>
        </form>
      </div>
    </Panel>
  );
}

export default async function AdminPage({ searchParams }: PageProps<'/admin'>) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { store } = gate.a;
  const sp = await searchParams;
  const q = (one(sp.q) ?? '').trim().slice(0, 200);
  const done = DONE[one(sp.done) ?? ''];
  const lookup = q ? parseLookup(q) : null;
  const byName = lookup && 'name' in lookup ? store.byName(lookup.name) : [];
  const found =
    lookup && 'steamId' in lookup ? store.bySteam(lookup.steamId) : lookup && 'discordId' in lookup ? store.byDiscord(lookup.discordId) : byName.length === 1 ? byName[0] : null;
  const counts = store.counts();
  const recent = store.recent(50);
  const log = store.auditLog(30);

  return (
    <>
      <PageHeader eyebrow="Staff" title="Admin" description={`Signed in as ${gate.admin.name}. Linked accounts and their queue tiers.`} />
      <Container className="mt-8 space-y-4">
        <AdminNav active="accounts" />
        {done && (
          <p
            role="status"
            className={`border px-4 py-3 text-sm ${done.good ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'}`}
          >
            {done.text}
          </p>
        )}

        <StatGrid className="grid-cols-2 sm:grid-cols-5">
          <Stat label="Linked" value={int(counts.total)} accent />
          <Stat label="Prio 1 · Admin" value={int(counts[1])} />
          <Stat label="Prio 2 · Premium" value={int(counts[2])} />
          <Stat label="Prio 3 · Verified" value={int(counts[3])} />
          <Stat label="No tier" value={int(counts.none)} />
        </StatGrid>

        <Panel title="Find a linked account">
          <form className="flex flex-wrap gap-2" action="/admin">
            <input
              name="q"
              defaultValue={q}
              placeholder="Discord name, SteamID, Discord ID, or a profile link"
              className="min-w-0 flex-1 border border-line-strong bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button className={buttonClass('primary')}>Find</button>
          </form>
          {q && !lookup && <p className="mt-3 text-sm text-bad">Type at least two characters.</p>}
          {lookup && !found && byName.length === 0 && <p className="mt-3 text-sm text-muted">No linked account matches.</p>}
          {byName.length > 1 && (
            <ul className="mt-3 divide-y divide-line border border-line text-sm">
              {byName.map((l) => (
                <li key={l.discordId}>
                  <Link prefetch={false} href={`/admin?q=${l.discordId}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2">
                    <span className="font-medium">{l.discordName}</span>
                    {l.tier ? <TierBadge tier={l.tier} compact /> : <span className="text-dim">—</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {found && <LinkCard link={found} env={gate.a.env} />}

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Newest links" flush action={`${int(recent.length)} of ${int(counts.total)}`}>
            {recent.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Discord</th>
                      <th>Tier</th>
                      <th className="r">Linked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((l) => (
                      <tr key={l.discordId}>
                        <td>
                          <Link prefetch={false} href={`/admin?q=${l.discordId}`} className="link">
                            {l.discordName ?? <span className="font-mono text-xs">{l.discordId}</span>}
                          </Link>
                        </td>
                        <td>{l.tier ? <TierBadge tier={l.tier} compact /> : <span className="text-dim">—</span>}</td>
                        <td className="r text-muted">{ts(l.linkedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nobody has linked yet.</Empty>
            )}
          </Panel>

          <Panel title="Audit log" flush action="Last 30 staff actions">
            {log.length ? (
              <ul className="divide-y divide-line text-sm">
                {log.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                    {e.action === 'export' ? (
                      <span>
                        <span className="font-medium">{e.adminName ?? <span className="font-mono text-xs">{e.adminDiscordId}</span>}</span>{' '}
                        downloaded the linked-accounts CSV{e.detail && <span className="text-muted"> · {e.detail}</span>}
                      </span>
                    ) : (
                      <span>
                        <span className="font-medium">{e.adminName ?? <span className="font-mono text-xs">{e.adminDiscordId}</span>}</span>{' '}
                        <span className={e.action === 'unlink' ? 'text-bad' : 'text-text'}>
                          {e.action === 'unlink'
                            ? 'unlinked'
                            : e.action === 'style'
                              ? 'changed the name style of'
                              : e.action === 'profile'
                                ? 'moderated the profile of'
                                : 're-checked'}
                        </span>{' '}
                        <Link prefetch={false} href={`/admin?q=${e.targetDiscordId}`} className="link">
                          {e.targetName ?? <span className="font-mono text-xs">{e.targetDiscordId}</span>}
                        </Link>
                        {e.targetSteamId && <span className="font-mono text-xs text-dim"> (Steam {e.targetSteamId})</span>}
                        {e.detail && <span className="text-muted"> {e.action === 'style' ? 'to ' : '· '}{e.detail}</span>}
                      </span>
                    )}
                    <span className="text-xs text-muted">{ts(e.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No staff actions yet.</Empty>
            )}
          </Panel>
        </div>
      </Container>
    </>
  );
}
