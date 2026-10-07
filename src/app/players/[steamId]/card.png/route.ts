// The preview picture chat apps show for a profile link (see lib/server/card.ts).
import { playerCard } from '@/lib/server/card';

export async function GET(_req: Request, { params }: RouteContext<'/players/[steamId]/card.png'>) {
  const { steamId } = await params;
  const card = await playerCard(steamId);
  return new Response(card.png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${card.maxAge}`,
    },
  });
}
