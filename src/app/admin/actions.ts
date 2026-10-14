'use server';
// Staff actions on /admin. Each re-checks, live with Discord, that the caller is staff right now;
// Next rejects cross-origin posts to Server Actions. Every change is written to the audit log.
import { notFound, redirect } from 'next/navigation';
import type { Accounts } from '@/lib/server/accounts';
import { currentAdmin } from '@/lib/server/accounts/admin';
import type { Link as AccountLink } from '@/lib/server/accounts/store';
import { refreshTier } from '@/lib/server/accounts/sync';
import { isNameStyle, NAME_STYLE_LABELS } from '@/lib/name-styles';

const SNOWFLAKE = /^\d{17,20}$/;

/** Who did it and to whom, by name as well as id, so the log still reads after an unlink. */
function names(a: Accounts, adminId: string, sessionName: string, target: AccountLink) {
  return {
    adminDiscordId: adminId,
    adminName: a.store.byDiscord(adminId)?.discordName ?? sessionName,
    targetName: target.discordName,
  };
}

async function target(form: FormData) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const discordId = String(form.get('discordId') ?? '');
  if (!SNOWFLAKE.test(discordId)) notFound();
  return { ...gate, discordId, link: gate.a.store.byDiscord(discordId) };
}

export async function recheckAccount(form: FormData) {
  const { a, admin, discordId, link } = await target(form);
  if (!link) redirect(`/admin?q=${discordId}&done=gone`);
  let done = 'rechecked';
  try {
    await refreshTier(a.env, a.store, discordId);
  } catch (e) {
    console.error('[admin] recheck failed:', e instanceof Error ? e.message : e);
    done = 'discord-down';
  }
  a.store.log({ ...names(a, admin.discordId, admin.name, link), action: 'recheck', targetDiscordId: discordId, targetSteamId: link.steamId });
  redirect(`/admin?q=${discordId}&done=${done}`);
}

export async function unlinkAccount(form: FormData) {
  const { a, admin, discordId, link } = await target(form);
  if (!link) redirect(`/admin?q=${discordId}&done=gone`);
  if (form.get('confirm') !== 'yes') redirect(`/admin?q=${discordId}&done=unconfirmed`);
  a.store.unlink(discordId);
  a.store.log({ ...names(a, admin.discordId, admin.name, link), action: 'unlink', targetDiscordId: discordId, targetSteamId: link.steamId });
  console.log(`[admin] ${admin.discordId} unlinked ${discordId} (Steam ${link.steamId})`);
  redirect(`/admin?done=unlinked`);
}

/** Give an account its own name style, or "default" to go back to its tier's. */
export async function setNameStyle(form: FormData) {
  const { a, admin, discordId, link } = await target(form);
  if (!link) redirect(`/admin?q=${discordId}&done=gone`);
  const value = String(form.get('style') ?? '');
  const style = isNameStyle(value) ? value : null;
  if (value !== 'default' && !style) notFound();
  a.store.setNameStyle(discordId, style);
  a.store.log({
    ...names(a, admin.discordId, admin.name, link),
    action: 'style',
    targetDiscordId: discordId,
    targetSteamId: link.steamId,
    detail: style ? NAME_STYLE_LABELS[style] : 'tier default',
  });
  redirect(`/admin?q=${discordId}&done=styled`);
}

/** Remove an account's bio (one that breaks the rules), or with reset=yes their whole custom profile. */
export async function clearProfile(form: FormData) {
  const { a, admin, discordId, link } = await target(form);
  if (!link) redirect(`/admin?q=${discordId}&done=gone`);
  const reset = form.get('reset') === 'yes';
  if (reset) a.store.setProfile(discordId, { bio: null, colour: null, featured: [] });
  else a.store.clearBio(discordId);
  a.store.log({
    ...names(a, admin.discordId, admin.name, link),
    action: 'profile',
    targetDiscordId: discordId,
    targetSteamId: link.steamId,
    detail: reset ? 'custom profile reset' : link.bio ? `bio removed: "${link.bio}"` : 'bio removed',
  });
  redirect(`/admin?q=${discordId}&done=${reset ? 'profile-reset' : 'bio-cleared'}`);
}
