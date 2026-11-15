'use server';
// Staff actions on /admin/rotation: switch the weighted map rotation on or off for a server. Each
// re-checks, live with Discord, that the caller is staff right now.
import { notFound, redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { visibleServerIds } from '@/lib/server/data';
import { rotationConfig } from '@/lib/server/warcon/rotation-config';
import { siteEnv } from '@/lib/server/warcon/env';

export async function switchRotation(form: FormData) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const serverId = String(form.get('serverId') ?? '');
  if (!(await visibleServerIds()).includes(serverId)) notFound();
  const config = rotationConfig(siteEnv().warconBaseUrl, process.env.WARCON_ROTATION_TOKEN);
  if (!config) redirect('/admin/rotation?done=nokey');
  const { store } = gate.a;
  const by = store.byDiscord(gate.admin.discordId)?.discordName ?? gate.admin.name;
  const on = form.get('on') === 'yes';
  let done = on ? 'on' : 'off';

  if (on) {
    // The rotation it has now, to put back when it's switched off.
    let saved: string[];
    try {
      saved = await config.read(serverId);
    } catch (e) {
      console.error('[rotation] reading the rotation to keep failed:', e instanceof Error ? e.message : e);
      redirect('/admin/rotation?done=readfailed');
    }
    store.setRotationEnabled(serverId, true, saved, by);
  } else {
    const saved = store.rotationServer(serverId)?.saved;
    store.setRotationEnabled(serverId, false, null, by);
    if (saved?.length) {
      try {
        await config.write(serverId, saved);
      } catch (e) {
        console.error('[rotation] putting the old rotation back failed:', e instanceof Error ? e.message : e);
        done = 'restorefailed';
      }
    }
  }
  console.log(`[rotation] ${gate.admin.discordId} switched the weighted rotation ${on ? 'on' : 'off'} on ${serverId}`);
  redirect(`/admin/rotation?done=${done}`);
}
