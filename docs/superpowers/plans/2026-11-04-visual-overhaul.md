# Visual Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the whole public site in the approved dark "chunky" style with a persistent three.js sky-island scene, regroup navigation into Live · Stats · Players · You, and animate page changes with a card swipe.

**Architecture:** Same Next.js 16 App Router app. Colours stay as `:root` tokens in `globals.css`; shared look lives in `src/components/ui.tsx` primitives and a few global classes, so most pages change through those. The scene is one client component mounted in the root layout (never remounted on navigation), with its pure logic (framing, story timeline, mode) in `src/lib/scene/` under unit tests and the three.js world ported from the approved mockup. Page swipe uses React `<ViewTransition>` keyed on pathname only.

**Tech Stack:** Next.js 16.3 (App Router, React 19.2), Tailwind 4, three.js (new npm dependency), vitest (node environment, `src/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-11-04-visual-overhaul-design.md`. Reference mockup: `.superpowers/brainstorm/9319-1793823081/content/scene-v5.html` (panel option 2 "Server tabs", style "Floating card"). Port visual values and the scene from it.

## Global Constraints

- Dark only. No `[data-theme='light']`, no theme cookie, no theme toggle or prompt anywhere.
- Colours only as `:root` tokens in `src/app/globals.css`. Palette: bg `#16131c`, slab `#221e2b` (cards at ~86% opacity + backdrop blur), raised `#2c2738`, ink `#f4efe6`, muted `#b3aabd`, edge `#07060a`, accent `#ffc93c`, accent-ink `#1d1606`, good `#2fd4a3`, manticore `#8be36b`, lonestar `#5aa8ff`, valkyra `#ff6b6b`; dark text on faction fills `#140f0a`.
- Material: 3px edge borders; hard straight-down shadows (cards 6px, pills 4px, badges 3px), no blur; radii cards 30px, server tabs 22px, rank badges 14px, pills/bars round. Pills sink on hover/press.
- Type: Unbounded 800/900 (headings, big numbers, rank badges), Rubik 400–800 (everything else), via `next/font/google`. Mixed case; no uppercase wide-tracked labels. Numbers tabular.
- Scores are three teams racing to `KOTH_CAP` (100, `src/lib/game.ts`). Never a two-team bar.
- The zod schemas in `src/lib/server/warcon/schemas.ts` are untouched.
- Pages stay async server components; each data panel keeps its `<Section>` so a Warcon failure degrades one card.
- three.js is an npm dependency bundled by the build. No CDN script tags. The VPS never builds.
- Every `<Link>` to `/players/…` or `/matches/…` keeps `prefetch={false}` (`src/lib/no-heavy-prefetch.test.ts`).
- Friend presence surfaces use `FriendStatus.online`, which is already masked by "hide where I'm playing"; never derive presence from raw server player lists.
- `prefers-reduced-motion`: scene shows one still frame; page swipe is off.
- Phone width: 16px gutters, no horizontal scroll, bottom tab bar never covers content.
- `/admin/*` inherits tokens and header only; it stays out of the nav.
- One branch, one PR, one deploy. Commit locally per task; do not push until the owner says so.

## Review Focus

1. **Warcon down or a server with `status: null` / offline** → its tab is greyed, cannot open, never chosen as default; the page still renders. Pinned in Task 6 (`defaultOpenServer`, `roundHeadline` empty-scores tests).
2. **Friend who hides where they play** (`online: null`) → never appears in a server tab or the You menu. Pinned in Task 6 (`friendsByServer`) and Task 7 (route returns only `online` non-null).
3. **AutoRefresh every 15s** → must not swipe the page or close the server tab the viewer opened. Pinned in Task 9 (`shouldSwipe`) and Task 6 (`keepOpen`).
4. **No WebGL / reduced motion / hidden tab** → sky gradient only, or one still frame, or paused; never a blank or broken page. Pinned in Task 5 (`sceneMode`).
5. **Logged-in visitor on a phone** → Account settings and Sign out reachable from the You tab; bottom bar never hides the footer or last card. Pinned in Task 3 (`activeTab`, You items) and checked in Task 10's phone-width pass.

---

### Task 1: Branch, tokens, fonts, dark only

**Files:**
- Modify: `.gitignore` (add `.superpowers/`)
- Modify: `src/app/globals.css` (replace both token blocks with one dark `:root`; redefine `.display`, `.eyebrow`, `.panel`, `.link`, `.num`; drop `.grid-bg` and every `[data-theme='light']` rule; add `.sky` gradient)
- Modify: `src/app/layout.tsx` (fonts, remove theme)
- Modify: `src/app/manifest.ts` (theme/background colour → `#16131c`)
- Delete: `src/components/theme.tsx`, `src/lib/theme.ts`, `src/lib/theme.test.ts`
- Create: `src/lib/design-guard.test.ts`

**Interfaces:**
- Produces: Tailwind colour names unchanged (`bg`, `surface`, `surface-2`, `surface-3`, `line`, `line-strong`, `text`, `muted`, `dim`, `accent`, `accent-ink`, `accent-soft`, `good`, `bad`, `valkyra`, `lonestar`, `manticore`) plus new `edge`, `slab`, `raised`. CSS variables `--font-unbounded`, `--font-rubik`; Tailwind `font-display` → Unbounded, `font-sans` → Rubik. Global classes `.slab` (card material), `.pill`, `.pill-on`, `.edge` (3px edge + hard shadow), `.sky` (sunset gradient: `#120e26 0%, #251a4d 30%, #4a2f72 55%, #9b4f86 78%, #f08a6c 100%`).

Map old tokens onto the new palette (`surface`→slab, `surface-2`/`surface-3`→raised, `line`→`#ffffff14`, `line-strong`→edge, `dim`→muted at lower contrast but ≥4.5:1 on slab, `bad`→valkyra red). `.profile-theme` keeps re-pointing `--accent` (drop its light variant). Name-style colours keep their dark values.

- [ ] **Step 1:** `git switch -c visual-overhaul`; add `.superpowers/` to `.gitignore`.
- [ ] **Step 2: Write the failing guard test** `src/lib/design-guard.test.ts`, scanning `src/**/*.{ts,tsx,css}` like `no-heavy-prefetch.test.ts` does:
  - `test('no light theme left')`: no file contains `data-theme='light'`, `data-theme="light"`, `@/lib/theme` or `ThemeToggle`.
  - `test('no CDN scripts')`: no `.tsx` contains `cdnjs.cloudflare.com` or `unpkg.com`.
- [ ] **Step 3:** Run `npx vitest run src/lib/design-guard.test.ts`. Expected: FAIL on the light-theme test.
- [ ] **Step 4:** Make the token and font changes above. In `layout.tsx`: remove `savedTheme`, `ThemeToggle`, `ThemePrompt`, `data-theme`; `export const viewport = { themeColor: '#16131c' }` instead of `generateViewport`; `<body className="sky ...">`; `<InstallPrompt auto />`; Barlow, Inter and JetBrains replaced by Unbounded (`weight: ['800','900']`) and Rubik (`weight: ['400','500','700','800']`). Delete `public/fonts/` files that only the OG card used only if Task 10 replaces them; otherwise leave them.
- [ ] **Step 5:** Run `npx vitest run src/lib/design-guard.test.ts && npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6:** Commit `"Dark-only chunky tokens and fonts"`.

### Task 2: UI primitives in the chunky style

**Files:**
- Modify: `src/components/ui.tsx`
- Modify: `src/components/game.tsx` (`FactionScores`, `KillLine`/`KillList` name pills, `ServerCard` restyle)
- Modify: `src/lib/game.ts` (add `rankColour`)
- Test: `src/lib/game.test.ts`, `src/components/meter.test.ts`

**Interfaces:**
- Produces in `src/lib/game.ts`: `rankColour(rank: number, faction?: string | null): string` → `'#ffc93c'` for 1, `'#d9d4e0'` for 2, `'#e29b62'` for 3, otherwise `factionColor(faction)` (its existing fallback when null).
- Produces in `ui.tsx` (existing names keep their props): `Panel` renders a `.slab` card with Unbounded title and an optional `action`; `PanelLink` is accent text "Label →"; `RankCell` renders a rank badge (`rankColour`), `Meter` is a fat rounded track with edge; `Segmented` and `Pagination` render pills; `Badge` tones map to chip fills (`good`→good, `bad`→valkyra, `accent`→accent, `default`→raised).
- New in `ui.tsx`: `Pill({ href, on, children, prefetch? })`; `RaceLane({ name, score, cap, color })` (name, big score, track filled to `score/cap`); `ScoreChips({ scores }: { scores: { name: string; score: number }[] })` (three small faction-filled tags, highest first); `ClosenessChip({ scores }: { scores: number[] })` using `closeness`/`bandOf`/`bandLabel`/`BAND_TONE` from `src/lib/balance.ts`, rendering nothing when `closeness` is null.
- `FactionScores` becomes three `RaceLane`s (cap = `scoreCap ?? KOTH_CAP`).

- [ ] **Step 1: Write failing tests** in `src/lib/game.test.ts`: `rankColour(1)==='#ffc93c'`, `rankColour(2)==='#d9d4e0'`, `rankColour(3)==='#e29b62'`, `rankColour(7,'Manticore')===factionColor('Manticore')`, `rankColour(7,null)===factionColor(null)`.
- [ ] **Step 2:** Run `npx vitest run src/lib/game.test.ts`. Expected: FAIL, `rankColour` not exported.
- [ ] **Step 3:** Implement `rankColour` and restyle/add the primitives above. Keep `meterWidth` behaviour (its test stays green).
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass.
- [ ] **Step 5:** Commit `"Chunky UI primitives"`.

### Task 3: Navigation model, header, You menu, bottom bar

**Files:**
- Create: `src/lib/nav.ts`, `src/lib/nav.test.ts`
- Create: `src/components/nav.tsx` (client: `TopNav`, `YouMenu`, `BottomBar`)
- Modify: `src/components/client.tsx` (delete `NavLinks`; keep `AutoRefresh`, `CopyButton`, `SearchBox` restyled as a pill)
- Modify: `src/app/layout.tsx` (header, footer, bottom padding on phones)

**Interfaces:**
- Produces in `src/lib/nav.ts`:
  - `type TabKey = 'live' | 'stats' | 'players' | 'you'`
  - `const TABS: { key: Exclude<TabKey,'you'>; label: string; href: string }[]` = Live `/`, Stats `/leaderboards`, Players `/players`
  - `activeTab(pathname: string): TabKey | null`: live for `/` (exact), `/servers*`, `/feed*`, `/matches*`; stats for `/leaderboards*`, `/skill*`, `/records*`, `/clans*`; players for `/players*`, `/compare*`; you for `/account*`, `/friends*`; null otherwise (e.g. `/admin`, `/api-docs`).
  - `youItems(me: { steamId: string | null } | null): { label: string; href: string }[]`: null → `[{ 'Sign in', '/account' }]`; signed in without Steam → Account settings `/account`, Friends `/friends`; with Steam → My profile `/players/<id>`, Friends `/friends`, Account settings `/account`. Sign out is a form, not an item.
- Consumes: `signOut` server action from `src/app/account/actions.ts`; `useFriendNews`, `newsCount`, `FriendToast` from `src/components/friend-news.tsx`.
- Produces: `<TopNav me linking />` (logo, three `Pill`s with `activeTab`, search pill → `/players`, You pill with avatar and friend-news badge opening `YouMenu`); `<BottomBar me />` fixed bottom, `md:hidden`, four tabs; layout `<main>` gets `pb-24 md:pb-0`. Header shows at every width (no hamburger). Footer: Public API (`/api-docs`), `InstallLink`, attribution text.
- When account linking is off (`linkingOn()` false), You pill and You tab are hidden.

- [ ] **Step 1: Write failing tests** `src/lib/nav.test.ts`: `activeTab('/')==='live'`, `activeTab('/servers/eu1')==='live'`, `activeTab('/matches/1/2')==='live'`, `activeTab('/skill')==='stats'`, `activeTab('/clans/abc')==='stats'`, `activeTab('/compare')==='players'`, `activeTab('/players/7656')==='players'`, `activeTab('/account')==='you'`, `activeTab('/friends')==='you'`, `activeTab('/admin')===null`, `activeTab('/serversx')===null`; `youItems(null)` deep-equals `[{label:'Sign in',href:'/account'}]`; `youItems({steamId:'1'}).map(i=>i.href)` equals `['/players/1','/friends','/account']`; `youItems({steamId:null}).map(i=>i.href)` equals `['/account','/friends']`.
- [ ] **Step 2:** Run `npx vitest run src/lib/nav.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement `nav.ts`, then `nav.tsx` and the layout changes. Every `/players/` link in the menu uses `prefetch={false}`.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint`. Expected: pass.
- [ ] **Step 5:** `npm run dev:mock`, then `curl -s localhost:3000/ | grep -c 'aria-label="Main"'` → at least 1, and `curl -s localhost:3000/account -o /dev/null -w '%{http_code}'` → 200.
- [ ] **Step 6:** Commit `"Four-tab nav, You menu, bottom bar"`.

### Task 4: Stats tabs and Compare button

**Files:**
- Create: `src/components/stats-tabs.tsx` (`StatsTabs({ current }: { current: 'leaderboards'|'skill'|'records'|'clans' })`, pills to `/leaderboards`, `/skill`, `/records`, `/clans`)
- Modify: `src/app/leaderboards/page.tsx`, `src/app/skill/page.tsx`, `src/app/records/page.tsx`, `src/app/clans/page.tsx` (render `StatsTabs` under the page title)
- Modify: `src/app/players/[steamId]/page.tsx` (a "Compare with…" `Pill` → `/compare?a=<steamId>`)
- Modify: `src/app/compare/page.tsx` (if only `a` is set, focus the second search; no other change)

URLs all stay; nothing redirects (spec leaves this to the builder; keeping them avoids broken links).

- [ ] **Step 1:** Implement the above.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint`. Expected: pass.
- [ ] **Step 3:** With `dev:mock`: `for p in leaderboards skill records clans; do curl -s localhost:3000/$p | grep -c 'href="/skill"'; done` → each ≥1; a profile page contains `href="/compare?a=`.
- [ ] **Step 4:** Commit `"Stats tabs and compare button"`.

### Task 5: The sky-island scene

**Files:**
- `npm install three` and `npm install -D @types/three` (pin exact versions in `package.json`)
- Create: `src/lib/scene/framing.ts`, `src/lib/scene/story.ts`, `src/lib/scene/mode.ts`, and tests beside each
- Create: `src/components/scene/world.ts` (three.js: build island, helicopter, launcher, missile, particles, lights, clouds; ported from the mockup)
- Create: `src/components/scene/scene.tsx` (`'use client'` `<Scene />`)
- Modify: `src/app/layout.tsx` (mount `<Scene />` once, before the header, `aria-hidden`)

**Interfaces:**
- `framing.ts`: `viewOffset(view: { w: number; h: number }, gap: { left: number; top: number; width: number; height: number } | null): { x: number; y: number }` → `{0,0}` for null; else `x = w/2 - (gap.left + gap.width/2)` and `y = h/2 - (gap.top + Math.min(gap.top + gap.height, h)) / 2`, as the mockup's `size()`. `gap.top` is in page coordinates (`rect.top + scrollY`), so scrolling never moves the island. `approach(current: number, target: number, dt: number, rate = 4): number` (exponential ease toward target, never overshoots).
- `story.ts`: `type Phase = 'fly' | 'missile' | 'falling' | 'burning'`; `interface Story { phase: Phase; t: number }` (seconds in phase); `const FLY_S = 6, FALL_S = 3.4, BURN_S = 8`; `advance(s: Story, dt: number, ev: { missileHit: boolean }): Story`: fly→missile after `FLY_S`; missile→falling when `ev.missileHit`; falling→burning after `FALL_S`; burning→fly after `BURN_S`; `t` resets on every change.
- `mode.ts`: `sceneMode(env: { webgl: boolean; reducedMotion: boolean }): 'off' | 'still' | 'live'` → no webgl → off; reduced motion → still; else live.
- `world.ts`: `createWorld(canvas: HTMLCanvasElement): { frame(dt: number, story: Story): { missileHit: boolean }; setOffset(x: number, y: number): void; resize(w: number, h: number): void; dispose(): void }`. Look and behaviour from the mockup: toon 3-step gradient, inverted-hull outlines, floating island with rock cone and loose rocks, town, tower, trees, three faction flags, jeep, clouds under and behind, black helicopter, tracking launcher, homing missile with trail, tail piece falling off, spin-in, tower cap and debris, fire and smoke pools, camera fixed with slow drift, small mouse nudge and small shake. Camera FOV 36, position radius 72, height 36, look-at y 4; helicopter circle radius 27 height 14; pixel ratio capped at 2.
- `scene.tsx`: dynamic `import('./world')` after mount; reads `sceneMode`; pauses its loop on `document.hidden`; each animation frame reads `document.querySelector('[data-scene-gap]')` bounds (null elsewhere), computes the target `viewOffset`, eases toward it with `approach`; still mode renders one frame with the helicopter mid-circle; disposes on unmount. The canvas is `position: fixed; inset: 0; z-index: 0`, transparent, above `.sky`.

- [ ] **Step 1: Write failing tests**:
  - `framing.test.ts`: `viewOffset({w:1000,h:800}, null)` → `{x:0,y:0}`; a gap `{left:0,top:100,width:600,height:600}` → `x === 200` and `y === 0`; a gap `{left:0,top:100,width:600,height:2000}` → `y === -50` (bottom clipped to the viewport); `approach(0,10,0.1)` is between 0 and 10; `approach(9.999,10,10)` ≤ 10; `approach(5,5,1) === 5`.
  - `story.test.ts`: from `{phase:'fly',t:0}`, `advance(…, FLY_S + 0.01, {missileHit:false}).phase === 'missile'`; missile stays missile with `missileHit:false` for any dt; `missileHit:true` → `'falling'` with `t === 0`; falling → burning after `FALL_S`; burning → fly after `BURN_S`.
  - `mode.test.ts`: the three cases above.
- [ ] **Step 2:** Run `npx vitest run src/lib/scene`. Expected: FAIL, modules missing.
- [ ] **Step 3:** Implement the three pure modules.
- [ ] **Step 4:** Run `npx vitest run src/lib/scene`. Expected: PASS.
- [ ] **Step 5:** Port the mockup's world into `world.ts` (TypeScript, three from npm) and write `scene.tsx`; mount it in the layout.
- [ ] **Step 6:** Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: pass; the build output lists no three.js in the first-load shared chunk (it's dynamically imported).
- [ ] **Step 7:** Owner check in a browser: scene shows behind every page, survives navigation without restarting, still frame with reduced motion on.
- [ ] **Step 8:** Commit `"Sky-island scene"`.

### Task 6: The Live page

**Files:**
- Create: `src/lib/live.ts`, `src/lib/live.test.ts`
- Create: `src/components/server-tabs.tsx` (client), `src/components/top-dogs.tsx` (client K/D · Kills switch)
- Modify: `src/app/page.tsx` (rewrite)

**Interfaces:**
- `live.ts` (client-safe, no server imports):
  - `interface TabServer { id: string; shortName: string; online: boolean | null; playerCount: number; maxPlayers: number | null; map: string | null; lighting: string | null; scores: { name: string; score: number }[]; cap: number; startedAt: number | null; topKillers: { name: string; steamId: string; faction: string; kills: number }[] }`
  - `toTabServer(s: ServerRow): TabServer` (top 3 `players` by kills; `cap = status?.scoreCap ?? KOTH_CAP`; `map` via `mapName`).
  - `isLive(s: TabServer): boolean` → `online === true && scores.length > 0`.
  - `defaultOpenServer(servers: TabServer[]): string | null` → id of the live server with most players; null if none live.
  - `keepOpen(prev: string | null, servers: TabServer[]): string | null` → `prev` if that server is still live, else `defaultOpenServer`.
  - `roundHeadline(s: { map: string | null; scores: { name: string; score: number }[]; cap: number }): string`. Sorted high→low as A,B,C. In order: no scores or all zero → `"Round just started on {map}."` (map "the map" when null); A ≥ cap → `"{A} have taken it."`; three within 8 → `"Dead even on {map}."`; A−B ≤ 3 → `"{A} and {B}, neck and neck."`; cap−A ≤ 20 → `"{A} are {cap−A} points from taking it."` (singular "point" at 1); A−B ≥ 25 → `"{A} are running away with it."`; else `"{A} lead {a}–{b}–{c}."` (two scores when only two teams reported).
  - `killerLine(top: { name: string; kills: number } | undefined): string | null` → `"{name} has {kills} kills."` when kills ≥ 10, else null.
  - `friendsByServer(friends: FriendStatus[]): Record<string, { steamId: string; name: string }[]>` keyed by `online.serverId`; skips `online === null` and `name === null`.
- `ServerTabs({ servers, friends, playing, up, total }: { servers: TabServer[]; friends: Record<string, {steamId:string;name:string}[]>; playing: number; up: number; total: number })`: floating `.slab` card, header "Servers" + "{playing} playing · {up} of {total} up"; one tab per server in the given order; banner `mapArt(map, lighting)` (fallback: plain raised fill) with short name and `{playerCount}/{maxPlayers}` or "offline"; line map · lighting name · time into round; three-segment score strip; friend pills "{names} are here"; opened tab: taller banner, `roundHeadline`, `killerLine`, top 3 this round, link "Server page →" to `serverPath`. Open state uses `keepOpen` on every new `servers` prop so `AutoRefresh` never closes it. Offline / not-live tabs are greyed and not clickable.
- `TopDogs({ kd, kills }: { kd: LeaderRow[]; kills: LeaderRow[] })`: card titled "Top dogs" with a `K/D · Kills` pill switch (local state, no URL change), top 3 with `RankCell`, "Leaderboards →". Rows for the 7d period have no movement arrows.
- `page.tsx` layout: `<AutoRefresh seconds={15} />`; top band grid `1fr 400px` (stacked under `lg`), left `<div data-scene-gap aria-hidden className="min-h-[calc(100vh-190px)] max-lg:h-[46vh]" />`, right `ServerTabs`; below, three columns (`lg:grid-cols-3 md:grid-cols-2`): `TopDogs` (`leaderboard({metric:'kd',period:'7d'})`, `leaderboard({metric:'kills',period:'7d'})`), Just finished (`endedRounds()` newest 4: server · map, `ScoreChips`, `ClosenessChip`, link to match page with `prefetch={false}`; "All matches →"), Kill feed (`recentKills({limit:8})`, "Full feed →"). Each wrapped in `<Section>`. Friends from the existing `friendsOfViewer()` helper.

- [ ] **Step 1: Write failing tests** in `src/lib/live.test.ts`:
  - `roundHeadline({map:'Ozeti',scores:[],cap:100})==='Round just started on Ozeti.'`
  - `roundHeadline({map:'Ozeti',scores:[{name:'Lonestar',score:47},{name:'Manticore',score:44},{name:'Valkyra',score:40}],cap:100})==='Dead even on Ozeti.'`
  - `…[Valkyra 71, Lonestar 70, Manticore 22]…==='Valkyra and Lonestar, neck and neck.'`
  - `…[Manticore 82, Lonestar 61, Valkyra 34]…==='Manticore are 18 points from taking it.'`
  - `…[Manticore 99, Lonestar 61, Valkyra 34]…==='Manticore are 1 point from taking it.'`
  - `…[Manticore 60, Lonestar 30, Valkyra 20]…==='Manticore are running away with it.'`
  - `…[Manticore 50, Lonestar 40, Valkyra 20]…==='Manticore lead 50–40–20.'`
  - `killerLine({name:'Kreeg',kills:31})==='Kreeg has 31 kills.'`; `killerLine({name:'x',kills:9})===null`; `killerLine(undefined)===null`.
  - `defaultOpenServer` picks the live server with most players, skips `online:false`, `online:null` and empty-score servers, returns null when none live.
  - `keepOpen('b', servers)==='b'` while b is live; falls back to `defaultOpenServer` when b goes offline.
  - `friendsByServer` groups by `online.serverId` and drops `online:null` and `name:null` entries.
- [ ] **Step 2:** Run `npx vitest run src/lib/live.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement `live.ts`.
- [ ] **Step 4:** Run `npx vitest run src/lib/live.test.ts`. Expected: PASS.
- [ ] **Step 5:** Build the components and rewrite `page.tsx`.
- [ ] **Step 6:** Run `npm test && npm run typecheck && npm run lint`. With `dev:mock`, `curl -s localhost:3000/ | grep -c 'data-scene-gap'` → 1 and the page contains "playing ·".
- [ ] **Step 7:** Commit `"Live page: server tabs, top dogs, just finished"`.

### Task 7: Moved panels and friends in the You menu

**Files:**
- Modify: `src/app/servers/page.tsx` (add "Network population · 24h" card: `population(null,'24h')` with `AreaChart`, as on today's home)
- Modify: `src/app/matches/page.tsx` (add "Faction wins · 7 days" card at the top: `factionWins(null)`, three `RaceLane`-style bars of wins share, same note text as today's home)
- Modify: `src/app/api/me/friends/route.ts` (add `online`)
- Modify: `src/components/nav.tsx` (`YouMenu` lists friends online)

**Interfaces:**
- Route response becomes `{ incoming: number; accepted: {steamId:string;name:string|null}[]; online: { steamId: string; name: string; serverName: string; serverSlug: string }[] }`; `online` built from `friendsPage(me.discordId).friends` where `status.online !== null && status.name !== null`; empty for anyone not signed in with Steam. Fetched by `YouMenu` only when opened.
- `useFriendNews` keeps reading `incoming`/`accepted` unchanged.

- [ ] **Step 1:** Implement the two moved cards and the route change.
- [ ] **Step 2:** `YouMenu`: on open, `fetch('/api/me/friends')`; show up to 5 "Name · Server" rows linking to the profile (`prefetch={false}`), then "All friends →".
- [ ] **Step 3:** Run `npm test && npm run typecheck && npm run lint`. With `dev:mock`, `/servers` contains "Network population" and `/matches` contains "Faction wins".
- [ ] **Step 4:** Commit `"Move population and faction wins; friends online in You menu"`.

### Task 8: Restyle the remaining pages

Most of the look arrives through Tasks 1–2 (tokens, `.display`, `.eyebrow`, `.panel`, primitives). This task removes leftover old-style markup and gives the crowded pages a lead card.

**Files (modify):** `src/app/servers/page.tsx`, `src/app/servers/[id]/page.tsx`, `src/app/feed/page.tsx`, `src/app/matches/page.tsx`, `src/app/matches/[serverId]/[matchId]/page.tsx`, `src/app/leaderboards/page.tsx`, `src/app/skill/page.tsx`, `src/app/records/page.tsx`, `src/app/clans/page.tsx`, `src/app/clans/[tag]/page.tsx`, `src/app/players/page.tsx`, `src/app/players/[steamId]/page.tsx`, `src/app/compare/page.tsx`, `src/app/account/page.tsx`, `src/app/account/customise.tsx`, `src/app/friends/page.tsx`, `src/app/api-docs/page.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, plus components they use (`charts.tsx`, `trends.tsx`, `replay.tsx`, `friends.tsx`, `milestones.tsx`, `recent-form.tsx`, `install.tsx`, `friend-news.tsx`, `tier.tsx`, `player.tsx`, `local-time.tsx`)
**Test:** `src/lib/design-guard.test.ts`

Rules: page title in Unbounded at the top (no hero banners with `MapBackdrop` behind text except the server page's own map); tables become rows inside a card, each row a rounded strip, the viewer's own row highlighted (`accent-soft`); filter controls are `Pill`s; server page and player profile get one wide lead card (server: live round with `RaceLane`s and map; profile: name, tier, headline stats) then the rest in uneven columns (`lg:grid-cols-[1.4fr_1fr]`), not an equal grid; every score display is three teams.

- [ ] **Step 1: Add a failing guard** to `design-guard.test.ts`: `test('no uppercase wide-tracked labels')` fails on any `.tsx` className containing both `uppercase` and `tracking-[0.1` (or `tracking-[0.2`, `tracking-[0.04`). Exempt nothing.
- [ ] **Step 2:** Run `npx vitest run src/lib/design-guard.test.ts`. Expected: FAIL listing files.
- [ ] **Step 3:** Restyle the pages above (Live-group pages, then Stats, then Players, then You and misc), running the guard as you go.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint`. Expected: pass, guard green.
- [ ] **Step 5:** With `dev:mock`, every route in the file list returns 200: `for p in / /servers /feed /matches /leaderboards /skill /records /clans /players /compare /account /friends /api-docs; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3000$p; done`, plus one server, match, clan and player page from the mock data.
- [ ] **Step 6:** Commit `"Restyle all pages"`.

### Task 9: Page swipe transitions

**Files:**
- Create: `src/lib/swipe.ts`, `src/lib/swipe.test.ts`
- Create: `src/components/page-swipe.tsx` (client)
- Modify: `src/app/layout.tsx` (wrap `{children}` in `<PageSwipe>`; give header, bottom bar and scene stable `view-transition-name`s so they don't animate)
- Modify: `src/app/globals.css` (keyframes)

Read `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` first (directional route transitions section).

**Interfaces:**
- `swipe.ts`: `shouldSwipe(prev: string, next: string): boolean` → compares pathnames only (strip `?…` and `#…`), true only when they differ.
- `PageSwipe({ children })`: uses `usePathname()`; wraps children in React `<ViewTransition>` keyed by pathname with `enter="swipe-in"` / `exit="swipe-out"` classes, so query changes and `router.refresh()` don't swipe. Under `prefers-reduced-motion: reduce` the classes animate nothing.
- CSS: `::view-transition-old(.swipe-out)` slides to `translateX(-110%)`; `::view-transition-new(.swipe-in)` from `translateX(110%)`; easing `cubic-bezier(.34,1.56,.64,1)`, ~450ms; small stagger between top-level cards (60ms each, up to 4) where each card is its own `<ViewTransition>` inside the page.

- [ ] **Step 1: Write failing tests**: `shouldSwipe('/a','/b')===true`; `shouldSwipe('/leaderboards?metric=kd','/leaderboards?metric=kills')===false`; `shouldSwipe('/','/')===false`; `shouldSwipe('/x#top','/x')===false`.
- [ ] **Step 2:** Run `npx vitest run src/lib/swipe.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `swipe.ts`, `PageSwipe`, CSS.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint`. Expected: pass.
- [ ] **Step 5:** Owner check in Chrome: Live → Stats swipes left with a bounce; changing a leaderboard filter and waiting through an auto-refresh on `/` do not swipe; the scene keeps running.
- [ ] **Step 6:** Commit `"Bouncy page swipe"`.

### Task 10: Leftovers, full check, PR

**Files:**
- Modify: `src/components/og-card.tsx` (palette to the new tokens' values; keep layout), `public/offline.html` (new palette and fonts' fallbacks), `src/app/admin/nav.tsx` (uses `Pill`), `README.md` / `CLAUDE.md` only if they mention themes or fonts
- Test: `src/lib/server/og-render.test.ts` stays green

- [ ] **Step 1:** Update the files above.
- [ ] **Step 2:** Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 3:** Phone-width pass (owner or devtools at 375px) on `/`, `/leaderboards`, a profile, `/account` signed in: no horizontal scroll, bottom bar visible, last card and footer not covered, Account settings and Sign out reachable from You.
- [ ] **Step 4:** Commit `"Palette for share cards, offline page and admin"`, then stop and ask the owner before pushing and opening the PR (release workflow: push, PR, CI, deploy only on their go-ahead).
