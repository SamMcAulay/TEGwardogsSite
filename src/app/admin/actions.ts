'use server';
// Staff actions on /admin. Each re-checks, live with Discord, that the caller is staff right now;
// Next rejects cross-origin posts to Server Actions. Every change is written to the audit log.
import { notFound, redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { refreshTier } from '@/lib/server/accounts/sync';

const SNOWFLAKE = /^\d{17,20}$/;

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
  a.store.log({ adminDiscordId: admin.discordId, action: 'recheck', targetDiscordId: discordId, targetSteamId: link.steamId });
  redirect(`/admin?q=${discordId}&done=${done}`);
}

export async function unlinkAccount(form: FormData) {
  const { a, admin, discordId, link } = await target(form);
  if (!link) redirect(`/admin?q=${discordId}&done=gone`);
  if (form.get('confirm') !== 'yes') redirect(`/admin?q=${discordId}&done=unconfirmed`);
  a.store.unlink(discordId);
  a.store.log({ adminDiscordId: admin.discordId, action: 'unlink', targetDiscordId: discordId, targetSteamId: link.steamId });
  console.log(`[admin] ${admin.discordId} unlinked ${discordId} (Steam ${link.steamId})`);
  redirect(`/admin?done=unlinked`);
}
