@AGENTS.md

# Project notes

- Stats site for TEG's WARDOGS servers. All stats come from Warcon's keyed API (`src/lib/server/warcon/`),
  cached in memory. The only stored state is linked Discord/Steam accounts and their priority tier
  (`src/lib/server/accounts/`, node:sqlite in `DATA_DIR`); it is optional and off when unconfigured.
- Pages are async server components calling `src/lib/server/data.ts`; each section wraps its data in
  `<Section>` (src/components/section.tsx) so a Warcon failure degrades one panel, not the page.
- The zod schemas in `src/lib/server/warcon/schemas.ts` are the privacy boundary: never make them loose,
  never add ping, notes, watch, risk, bans or IPs to them.
- Colours live only in the `:root` tokens in `src/app/globals.css`.
- Local run: `npm run dev:mock` (mock Warcon on :4100 plus next dev). Checks: `npm test`, `npm run lint`,
  `npm run typecheck`.
- Deployment: `docs/DEPLOYMENT.md`. CI builds the image and pushes it to ghcr.io; the VPS (4 GB, shared
  with Warcon and cloudflared) must never build: `scripts/deploy.sh <sha>` pulls, runs the doctor in it, swaps.
