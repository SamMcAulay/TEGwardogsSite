import Link from 'next/link';
import { NameTag } from '@/components/tier';
import { buttonClass, cx, Panel } from '@/components/ui';
import { milestones, type MilestoneTotals } from '@/lib/milestones';
import { nameStyleFor } from '@/lib/name-styles';
import { BIO_MAX, canCustomise, FEATURED_MAX, PROFILE_COLOURS } from '@/lib/profile-themes';
import { BIO_PROBLEMS, type BioProblem } from '@/lib/server/accounts/bio';
import type { Link as AccountLink } from '@/lib/server/accounts/store';
import { saveProfile } from './actions';

const STATUS: Record<string, { text: string; good: boolean }> = {
  saved: { text: 'Profile saved. It shows on your stats profile and its Discord card.', good: true },
  'not-allowed': { text: 'Custom profiles are for Premium members and staff.', good: false },
  ...Object.fromEntries(Object.entries(BIO_PROBLEMS).map(([k, text]) => [k, { text, good: false }])) as Record<BioProblem, { text: string; good: boolean }>,
};

/**
 * Premium members and staff: bio, profile colour and featured badges. Everyone else linked sees
 * what it is. `totals` are the player's career numbers (null when stats couldn't load).
 */
export function Customise({ link, name, totals, status }: { link: AccountLink; name: string; totals: MilestoneTotals | null; status?: string }) {
  if (!canCustomise(link.tier)) {
    return (
      <Panel title="Custom profile">
        <p className="text-sm text-muted">
          Premium members and staff can give their stats profile a bio, their own colour and featured badges,
          shown on the site and on their Discord card.
        </p>
      </Panel>
    );
  }
  const earned = totals ? milestones(totals).filter((m) => m.earned) : [];
  const note = status ? STATUS[status] : undefined;
  return (
    <Panel title="Customise your profile" action="Premium and staff">
      <div id="customise" className="scroll-mt-20" />
      {note && (
        <p role="status" className={cx('mb-4 border px-3 py-2 text-sm', note.good ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad')}>
          {note.text}
        </p>
      )}
      <form action={saveProfile} className="space-y-6">
        <label className="block">
          <span className="eyebrow !text-[0.66rem]">Bio</span>
          <textarea
            name="bio"
            maxLength={BIO_MAX}
            rows={2}
            defaultValue={link.bio ?? ''}
            placeholder="Sniper main, EU evenings. Say hi."
            className="mt-2 block w-full resize-none border border-line-strong bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <span className="mt-1 block text-xs text-dim">Up to {BIO_MAX} characters. No links. Staff can remove bios that break the rules.</span>
        </label>

        <fieldset>
          <legend className="eyebrow !text-[0.66rem]">Profile colour</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input type="radio" name="colour" value="" defaultChecked={!link.colour} className="peer sr-only" />
              <span className="flex h-9 items-center border border-line-strong px-3 text-xs text-muted peer-checked:border-text peer-checked:text-text peer-focus-visible:outline">
                Default
              </span>
            </label>
            {Object.entries(PROFILE_COLOURS).map(([key, c]) => (
              <label key={key} className="cursor-pointer" title={c.label}>
                <input type="radio" name="colour" value={key} defaultChecked={link.colour === key} className="peer sr-only" />
                <span
                  aria-label={c.label}
                  className="block size-9 border-2 border-transparent peer-checked:border-text peer-focus-visible:outline"
                  style={{ background: c.hex }}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow !text-[0.66rem]">Featured badges · up to {FEATURED_MAX}</legend>
          {earned.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {earned.map((m) => (
                <label key={m.key} className="cursor-pointer">
                  <input type="checkbox" name="featured" value={m.key} defaultChecked={link.featured.includes(m.key)} className="peer sr-only" />
                  <span className="block border border-line-strong px-2 py-1 text-xs text-muted peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent">
                    {m.earned}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-dim">{totals ? 'Earn a milestone badge to feature it here.' : 'Your badges are loading; try again in a minute.'}</p>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-muted">
            Your name shows as{' '}
            <NameTag style={nameStyleFor(link.tier, link.nameStyle)} className="font-display font-bold">
              {name}
            </NameTag>
            . Name colours are set by staff.
          </span>
          <div className="flex gap-2">
            <Link prefetch={false} href={`/players/${link.steamId}`} className={buttonClass('secondary')}>
              View profile
            </Link>
            <button className={buttonClass('primary')}>Save</button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

