'use server';
// Staff actions on /admin/teambalance: arm the balancer on a server for its next match, or cancel
// it. Each re-checks, live with Discord, that the caller is staff right now.
import { notFound, redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { visibleServerIds } from '@/lib/server/data';

/** The game caps a whisper at 256 characters; this leaves room for the team's name. */
const MAX_MESSAGE = 200;

export async function armBalancer(form: FormData) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const serverId = String(form.get('serverId') ?? '');
  if (!(await visibleServerIds()).includes(serverId)) notFound();
  const mode = form.get('mode') === 'live' ? 'live' : 'watch';
  if (mode === 'live' && form.get('confirm') !== 'yes') redirect('/admin/teambalance?done=unconfirmed');
  // Control characters out: it goes into the game's chat.
  const message = String(form.get('message') ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MESSAGE);
  const { a, admin } = gate;
  const id = a.store.armBalance({
    serverId,
    mode,
    message,
    armedBy: admin.discordId,
    armedByName: a.store.byDiscord(admin.discordId)?.discordName ?? admin.name,
  });
  console.log(`[teambalance] ${admin.discordId} armed ${mode} on ${serverId}${id ? '' : ' (already armed)'}`);
  redirect(`/admin/teambalance?done=${id ? 'armed' : 'busy'}`);
}

export async function cancelBalancer(form: FormData) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const id = Number(form.get('runId'));
  if (!Number.isInteger(id)) notFound();
  const by = gate.a.store.byDiscord(gate.admin.discordId)?.discordName ?? gate.admin.name;
  gate.a.store.endBalanceRun(id, 'cancelled', `Cancelled by ${by}.`);
  redirect('/admin/teambalance?done=cancelled');
}
