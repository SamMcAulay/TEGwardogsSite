@AGENTS.md

# Project notes

- Stats site for TEG's WARDOGS servers. Data comes from the game's RCON HTTP API (polled by
  `src/lib/server/worker.ts`) and its kill feed (`POST /api/ingest/events`), into SQLite.
- Pages are server components that call `src/lib/server/queries.ts` synchronously; no client data fetching
  except `AutoRefresh` (router.refresh on an interval).
- Schema changes: append a new entry to `MIGRATIONS` in `src/lib/server/db.ts`; never edit old ones.
- Leaderboards read `player_daily` / `weapon_daily` rollups. Anything that adds kills must keep them in step
  (see `ingestKills` / `recordPlayers` in `recorder.ts`).
- Kill queries use `CROSS JOIN servers` on purpose, to keep `kills` as the outer loop (see comment in queries.ts).
- Colours live only in the `:root` tokens in `src/app/globals.css`.
- Local run: `DEMO_MODE=true npm run seed && npm run demo`. Checks: `npm test`, `npm run lint`, `npm run typecheck`.
- Data sources per server, best first: RCON, Steam query (`a2s.ts`, count/map only, no Steam IDs), demo. Chosen in
  `pickSource` in `worker.ts`. Use `ServerRow.playerCount` for counts; `players` is empty for query-only servers.
- Deployment: `docs/DEPLOYMENT.md` is the runbook (VPS + Cloudflare Tunnel via `docker compose --profile tunnel`).
  `npm run doctor` / `docker compose run --rm doctor` checks connectivity; `/api/health` backs the Docker HEALTHCHECK.
  The game servers are run by someone else: changes there go in the admin message in DEPLOYMENT.md step 6.
