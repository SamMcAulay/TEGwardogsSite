// Optional Discord alerts when a server drops offline or comes back (DISCORD_WEBHOOK_URL).

import { env } from './config';

const OFFLINE_COLOR = 0xd86060;
const ONLINE_COLOR = 0x7bc462;

export async function notifyServerState(serverName: string, online: boolean, detail?: string | null): Promise<void> {
  if (!env.discordWebhookUrl) return;
  const res = await fetch(env.discordWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'TEG WARDOGS Stats',
      embeds: [
        {
          title: `${serverName} is ${online ? 'back online' : 'offline'}`,
          description: detail ? detail.slice(0, 300) : undefined,
          color: online ? ONLINE_COLOR : OFFLINE_COLOR,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
}
