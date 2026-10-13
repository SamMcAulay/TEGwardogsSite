import { accounts } from '@/lib/server/accounts';
import { handleInteraction, verifyDiscordRequest } from '@/lib/server/accounts/interactions';
import { playerName } from '@/lib/server/data';
import { siteEnv } from '@/lib/server/warcon/env';

export const dynamic = 'force-dynamic';

/** Discord's Interactions Endpoint URL: slash commands arrive here, signed by Discord. */
export async function POST(req: Request) {
  const a = accounts();
  const key = a?.env.discordPublicKey;
  if (!a || !key) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await req.text();
  // Discord also probes with bad signatures and requires a 401 for them.
  if (!verifyDiscordRequest(key, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), body)) {
    return new Response('invalid request signature', { status: 401 });
  }
  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  return Response.json(await handleInteraction(interaction, { env: a.env, store: a.store, siteUrl: siteEnv().siteUrl, playerName }));
}
