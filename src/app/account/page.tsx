import type { Metadata } from 'next';
import Link from 'next/link';
import { NameTag, TierBadge } from '@/components/tier';
import { buttonClass, Container, Empty, PageHeader, Panel } from '@/components/ui';
import { accounts, currentSession } from '@/lib/server/accounts';
import type { AuthError } from '@/lib/server/accounts/routes';
import { safe } from '@/components/section';
import { getPlayer, playerName as lookupPlayerName } from '@/lib/server/data';
import { canCustomise } from '@/lib/profile-themes';
import { classKills } from '@/lib/weapon-classes';
import { Customise } from './customise';
import { nameStyleFor } from '@/lib/name-styles';
import { TIERS, type Tier } from '@/lib/tiers';
import { one } from '@/lib/url';
import { signOut, unlinkSteam } from './actions';
import { setHidePresence } from '../friends/actions';

export const metadata: Metadata = { title: 'Account', robots: { index: false } };

const ERRORS: Record<AuthError, string> = {
  off: 'Account linking is not switched on for this site yet.',
  state: 'That sign-in took too long or was started in another browser. Please try again.',
  discord: 'Discord sign-in did not go through. Please try again.',
  signin: 'Sign in with Discord first, then link your Steam account.',
  steam: 'Steam could not confirm that sign-in. Please try again.',
  taken: 'That Steam account is already linked to a different Discord account. Unlink it there first, or ask a moderator.',
};

const primary = buttonClass('primary');
const secondary = buttonClass('secondary');

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 px-4 py-5">
      <span
        className={`flex size-7 shrink-0 items-center justify-center font-display text-sm font-bold ${done ? 'bg-good/15 text-good' : 'bg-surface-3 text-muted'}`}
        aria-hidden
      >
        {done ? '✓' : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="display text-[15px] tracking-[0.06em]">{title}</h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function AccountPage({ searchParams }: PageProps<'/account'>) {
  const sp = await searchParams;
  const error = one(sp.error) as AuthError | undefined;
  const a = accounts();
  const session = a ? await currentSession(a) : null;
  const link = a && session ? a.store.byDiscord(session.discordId) : null;
  // From the in-memory index, not a Warcon player lookup: a launch rush of people linking costs Warcon nothing.
  const playerName = link ? await lookupPlayerName(link.steamId) : null;
  // Featured badges need the player's totals: a full profile load, only for the few who may customise.
  const full = link && canCustomise(link.tier) ? await safe(getPlayer(link.steamId)) : null;
  const totals = full && !(full instanceof Error) ? { ...full.data.totals, classKills: classKills(full.data.weapons) } : null;

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Link your accounts"
        description="Link your Discord and Steam accounts to show your TEG status on your stats profile and, once Bulkhead ship tiered queues, get priority on WARDOGS servers."
      />
      <Container className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {error && ERRORS[error] && (
            <p role="alert" className="border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
              {ERRORS[error]}
            </p>
          )}
          {one(sp.linked) && link && (
            <p role="status" className="border border-good/40 bg-good/10 px-4 py-3 text-sm text-good">
              Steam account linked.
            </p>
          )}
          {!a ? (
            <Panel>
              <Empty>Account linking is not switched on for this site yet.</Empty>
            </Panel>
          ) : (
            <Panel flush>
              <ol className="divide-y divide-line">
                <Step n={1} title="Sign in with Discord" done={!!session}>
                  {session ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Signed in as <span className="font-medium text-text">{session.name}</span>
                      </span>
                      <form action={signOut}>
                        <button className={secondary}>Sign out</button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p>We only see your Discord id and name, and your roles in the TEG server.</p>
                      <a href="/auth/discord" className={primary}>
                        Sign in with Discord
                      </a>
                    </div>
                  )}
                </Step>
                <Step n={2} title="Link your Steam account" done={!!link}>
                  {!session ? (
                    <p>After signing in with Discord.</p>
                  ) : link ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Linked to{' '}
                        <Link prefetch={false} href={`/players/${link.steamId}`} className="link font-medium text-text">
                          {playerName ?? link.steamId}
                        </Link>
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <a href="/auth/steam" className={secondary}>
                          Change
                        </a>
                        <form action={unlinkSteam}>
                          <button className={secondary}>Unlink</button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p>Sign in through Steam so we know which WARDOGS player is you. We never see your Steam password.</p>
                      <a href="/auth/steam" className={primary}>
                        Sign in through Steam
                      </a>
                    </div>
                  )}
                </Step>
                <Step n={3} title="Your status" done={!!link?.tier}>
                  {!link ? (
                    <p>Shown once both accounts are linked.</p>
                  ) : link.tier ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <NameTag style={nameStyleFor(link.tier, link.nameStyle)} className="font-display text-xl font-bold">
                        {playerName ?? session!.name}
                      </NameTag>
                      <TierBadge tier={link.tier} />
                    </div>
                  ) : link.checkedAt === null ? (
                    <p>Checking your Discord roles. This can take a couple of minutes.</p>
                  ) : (
                    <p>
                      Your Discord account has no TEG role yet. Get verified in the TEG Discord, and your status will
                      update here within a few minutes.
                    </p>
                  )}
                </Step>
              </ol>
            </Panel>
          )}
          {link?.tier && (
            <Customise link={link} name={playerName ?? session!.name} totals={totals} status={one(sp.profile)} />
          )}
          {link && (
            <Panel title="Privacy">
              <form action={setHidePresence} className="flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="hide" value={link.hidePresence ? 'no' : 'yes'} />
                <input type="hidden" name="back" value="/account" />
                <p className="max-w-xl text-sm text-muted">
                  {link.hidePresence ? (
                    <>
                      <span className="font-semibold text-text">Where you&rsquo;re playing is hidden.</span> Only your{' '}
                      <Link href="/friends" className="link text-accent">
                        friends
                      </Link>{' '}
                      see which server you&rsquo;re on; everyone else sees &ldquo;Hidden player&rdquo; for 3 hours.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-text">Everyone can see where you&rsquo;re playing.</span> Hide it and only your{' '}
                      <Link href="/friends" className="link text-accent">
                        friends
                      </Link>{' '}
                      will.
                    </>
                  )}
                </p>
                <button className={buttonClass(link.hidePresence ? 'secondary' : 'primary')}>
                  {link.hidePresence ? 'Show to everyone' : 'Hide where I’m playing'}
                </button>
              </form>
            </Panel>
          )}
        </div>
        <Panel title="Queue priority">
          <ul className="space-y-3 text-sm">
            {([1, 2, 3] as Tier[]).map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="num w-14 shrink-0 font-display font-semibold text-muted">Prio {t}</span>
                <div className="min-w-0 space-y-1">
                  <TierBadge tier={t} />
                  <div className="text-muted">{TIERS[t].who}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-dim">
            Your status follows your Discord roles and refreshes every few minutes. Bulkhead&apos;s tiered queue
            isn&apos;t live yet, but link now: everyone already linked gets their priority from the day it starts.
          </p>
        </Panel>
      </Container>
    </>
  );
}
