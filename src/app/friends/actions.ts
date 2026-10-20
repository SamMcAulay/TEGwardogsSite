'use server';
// Friend requests and "hide where I'm playing". Each needs a signed-in member with a linked Steam
// account, and a friend must be linked too. Next rejects cross-origin posts to Server Actions.
import { redirect } from 'next/navigation';
import { accounts, viewer, type Accounts } from '@/lib/server/accounts';
import { FriendLimitError } from '@/lib/server/accounts/store';

/** The linked member on a Steam id (forms carry Steam ids: Discord ids stay off public pages). */
const memberOn = (a: Accounts, form: FormData) => a.store.bySteam(String(form.get('steamId') ?? ''))?.discordId ?? null;

/** Where to go afterwards: /friends, a profile, or /account; nothing else. */
function back(form: FormData, fallback = '/friends'): string {
  const to = String(form.get('back') ?? '');
  return /^\/(friends|account|players\/\d{17})$/.test(to) ? to : fallback;
}

async function me() {
  const a = accounts();
  const v = await viewer();
  if (!a || !v?.steamId) redirect('/account');
  return { a, store: a.store, me: v.discordId };
}

const done = (to: string, code: string) => redirect(`${to}${to.includes('?') ? '&' : '?'}done=${code}`);

export async function sendFriendRequest(form: FormData) {
  const { store, me: id } = await me();
  const them = store.bySteam(String(form.get('steamId') ?? ''));
  const to = back(form);
  if (!them || them.discordId === id) done(to, 'not-linked');
  try {
    const r = store.requestFriend(id, them!.discordId);
    done(to, r === 'friends' ? 'friends' : 'sent');
  } catch (e) {
    if (e instanceof FriendLimitError) done(to, 'limit');
    throw e;
  }
}

export async function answerFriendRequest(form: FormData) {
  const { a, store, me: id } = await me();
  const other = memberOn(a, form);
  const accept = form.get('accept') === 'yes';
  const to = back(form);
  if (!other) done(to, 'gone');
  try {
    done(to, store.answerFriend(id, other!, accept) ? (accept ? 'accepted' : 'denied') : 'gone');
  } catch (e) {
    if (e instanceof FriendLimitError) done(to, 'limit');
    throw e;
  }
}

/** Ends a friendship or takes back a request. */
export async function removeFriend(form: FormData) {
  const { a, store, me: id } = await me();
  const other = memberOn(a, form);
  if (other) store.removeFriend(id, other);
  done(back(form), 'removed');
}

export async function setHidePresence(form: FormData) {
  const { store, me: id } = await me();
  const hide = form.get('hide') === 'yes';
  store.setHidePresence(id, hide);
  done(back(form), hide ? 'hidden' : 'visible');
}
