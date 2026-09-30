import { NextResponse } from 'next/server';
import { z } from 'zod';
import { serverForFeedToken } from '@/lib/server/config';
import { db, nowSec } from '@/lib/server/db';
import { ingestKills } from '@/lib/server/recorder';

// The game appends `/api/ingest/events` to `[WDServerFeed] Url`, so set Url to this site's origin.

const eventSchema = z
  .object({
    eventId: z.string().min(1).max(64),
    type: z.string().max(64),
    eventTime: z.number().optional(),
    matchId: z.string().max(64).optional(),
    mapName: z.string().max(64).optional(),
    killerName: z.string().max(128).optional(),
    killerId: z.string().max(64).optional(),
    killerSteamId: z.string().max(32).optional(),
    victimName: z.string().max(128).optional(),
    victimId: z.string().max(64).optional(),
    victimSteamId: z.string().max(32).optional(),
    cause: z.string().max(160).optional(),
    distance: z.number().nonnegative().optional(),
    contextTags: z.array(z.string().max(160)).max(32).optional(),
  })
  .passthrough();

const bodySchema = z.object({
  serverId: z.string().optional(),
  serverName: z.string().optional(),
  events: z.array(eventSchema).max(500),
});

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const server = token ? serverForFeedToken(token) : null;
  if (!server) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const result = ingestKills(db(), server.id, body.events, nowSec());
  return NextResponse.json(result);
}
