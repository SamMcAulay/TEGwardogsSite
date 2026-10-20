// Every linked account as a CSV, for staff only; anyone else gets the ordinary 404. Each download
// goes in the audit log, since the file holds Discord names that are otherwise shown only on /admin.
import { notFound } from 'next/navigation';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { linksCsv } from '@/lib/server/accounts/export';
import { playerName } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { a, admin } = gate;
  const links = a.store.all();
  const names = new Map(await Promise.all(links.map(async (l) => [l.steamId, await playerName(l.steamId)] as const)));
  a.store.log({
    adminDiscordId: admin.discordId,
    adminName: a.store.byDiscord(admin.discordId)?.discordName ?? admin.name,
    action: 'export',
    targetDiscordId: admin.discordId,
    targetSteamId: null,
    targetName: null,
    detail: `${links.length} linked accounts`,
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(
    linksCsv(links, (id) => names.get(id) ?? null),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="teg-linked-accounts-${day}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
