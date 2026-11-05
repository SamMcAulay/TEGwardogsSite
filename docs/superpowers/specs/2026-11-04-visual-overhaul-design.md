# Visual overhaul: chunky sky-island redesign

Date: 2026-11-04. Status: awaiting owner approval.
Reference mockup (open in a browser; it uses the map images beside it):
`.superpowers/brainstorm/9319-1793823081/content/scene-v5.html`, with **panel option 2 (server tabs)** and
**panel style "floating card"** selected. That combination is the approved look for the Live page.

## Why

The site has grown to 20+ pages. It now looks like every other generated dark dashboard (near-black
background, one amber accent, uppercase wide-tracked labels, the same bordered `<Panel>` repeated down
every page) and the navigation has broken under the weight:

- The full nav only shows at `xl` (1280px+); everything narrower gets a hamburger, so the nav "vanishes"
  on laptops, tablets and phones. Search hides at the same width; the online count only shows at 1536px+.
- Once logged in, the account link becomes "My profile" (`src/app/layout.tsx`), so `/account` (linking,
  customise, privacy, sign out) has no nav entry; the only way in is a footer link labelled
  "Link Discord & Steam".
- `/compare`, `/skill` and `/api-docs` have no front door (footer or inline links only).
- 8 top-level tabs plus search, online pill, account and theme toggle are why it all collapses early.

The owner wants it to stop looking machine-made, be more fun, and be coherent: every page has an obvious
home, information comes first, nothing is tucked away. The owner's own sites (sammcaulay.dev,
Vyphir: `~/Documents/Websites/Portfolio/DESIGN.md`, `~/Documents/Websites/VyphirDIR`) are the taste
reference: big and chunky, unique, but data easy to reach, without the "4 cards in a row" pattern.

## Goals

1. Fix the navigation bugs above and regroup every page under four homes.
2. A distinctive chunky visual system, dark by default, applied consistently to every public page.
3. A persistent 3D sky-island scene behind the whole site, as atmosphere, never competing with data.
4. Page changes animate: the old page's cards swipe out to the left with a bouncy feel, the new page's
   cards swipe in from the right. The scene does not re-render between pages.

## Non-goals

- No new data, stats or features. Every number the site shows today keeps showing, in the same places
  of meaning. (The auto-written round headline is the one exception, below.)
- No framework change. It stays the existing Next.js 16 App Router app. No Astro.
- `/admin/*` is not redesigned beyond inheriting the new tokens and nav, and stays unlinked from the nav.
- No interactive 3D (no clicking the scene, no orbit controls).
- One-click server join stays declined (see project memory).

## Anti-goals (failure even if it "works")

- Information losing priority to decoration: the scene must never push data below the fold except the
  deliberate top window on the Live page.
- Things placed at random. Every element's position must follow from the grouping and reading order.
- Falling back to the generic look: uniform equal cards in a row, uppercase wide-tracked labels
  everywhere, coloured left-border "side tabs", near-black + single accent.
- A two-team score bar. This is a three-team game; King of the Hill's winning score is 100
  (`KOTH_CAP` in `src/lib/game.ts`).

## Constraints

- Colours live only in the `:root` tokens in `src/app/globals.css` (project rule). The new palette
  replaces the current tokens there; components keep reading tokens.
- The zod schemas are the privacy boundary; this work touches none of them.
- Pages stay async server components with `<Section>` per panel so a Warcon failure degrades one card.
- The VPS never builds; CI builds the image (`docs/DEPLOYMENT.md`). three.js must be an npm dependency
  bundled by the build, never a CDN script tag.
- Friends/privacy masking rules apply to any new presence surface (the server tabs' "top this round"
  must use the same masking as existing live lists).
- `prefers-reduced-motion`: the scene shows a single still frame and page transitions become instant.
- Must work at phone width (16px gutters, no horizontal scroll).

## Dark only (decided)

Light mode is removed (owner confirmed). The theme toggle, the first-visit theme prompt
(`ThemePrompt`), the theme cookie handling and the `[data-theme='light']` tokens all go.

## Information architecture (decided)

| Tab | Contains |
|---|---|
| **Live** | Home (`/`), servers (`/servers`, `/servers/[id]`), kill feed (`/feed`), matches (`/matches`, match pages) |
| **Stats** | Leaderboards (`/leaderboards`) with Skill as a tab inside it (today `/skill`), Records, Clans |
| **Players** | Search and profiles (`/players`, `/players/[steamId]`). Compare becomes a "Compare with…" button on every profile instead of a page of its own |
| **You** (avatar, top right) | My profile, Friends, Account settings, Sign out. Logged out: "Sign in" |

- Header: logo, the three tab pills (Live · Stats · Players), a search pill, the You/avatar pill. That's all.
- Phones: the four (Live, Stats, Players, You) become a fixed bottom tab bar that never disappears.
  Search stays reachable in the top bar.
- Footer: Public API docs, install app link, the existing attribution text.
- `/admin` stays unlinked.
- Friend news badge (currently on the Friends tab) moves onto the You pill / You tab.

Existing URLs keep working. Where a page is folded into another (`/skill`, `/compare`), the old URL
redirects or keeps rendering; builder's choice, but no link may 404.

## Visual system (decided)

Material is "chunky": everything looks pressable.

- **Edges:** 3px solid near-black (`#07060a`) borders on cards, pills, bars and badges.
- **Shadows:** hard, offset straight down (cards 6px, pills 4px, small badges 3px), same near-black,
  no blur. Pills sink on hover/press (translate down, shadow shrinks).
- **Radii:** cards 30px, server tabs 22px, rank badges 14px, pills and bars fully round.
- **Cards:** plum slab `#221e2b` at ~86% opacity with a backdrop blur, so the scene reads faintly
  through them.
- **Palette (dark only):** background `#16131c`, slab `#221e2b`, raised `#2c2738`, ink `#f4efe6`,
  muted `#b3aabd`, accent honey `#ffc93c` (on-accent ink `#1d1606`), good `#2fd4a3`.
  Faction fills: Manticore `#8be36b`, Lonestar `#5aa8ff`, Valkyra `#ff6b6b`. Text on faction fills is
  dark (`#140f0a`).
- **Type:** Unbounded (800/900) for headings, big numbers and rank badges; Rubik (400–800) for
  everything else. Normal mixed case; no uppercase wide-tracked labels. Numbers tabular.
- **Recurring components:** pill (nav, filters, links-as-buttons), rank badge (gold/silver/bronze for
  1–3, faction colour elsewhere), race lane (team name, big score, a fat track filled to score/100),
  fill meter (server population), finished-score chips (three small faction-coloured score tags plus a
  Fair/One-sided/Landslide chip using the existing closeness classification), kill-feed name pills in
  faction colours, dashed dividers between rows inside a card.
- Existing special name styles (premium, verified, aurora, pink) and profile colour themes carry over;
  they are re-pointed at the new tokens, not removed.

## The Live page (decided)

Reading order, top to bottom:

1. Header.
2. **Top band**, filling the first screen: an empty area on the left where the scene shows through, and
   on the right a tall **floating card of server tabs** (~400px wide).
   - One tab per current server, in the fixed server order (EU#1, EU#2, NA-West, NA-East). Each tab:
     the current map's screenshot as a short banner with the server name and player count over it,
     a line with map · weather · time into round, and a three-segment score strip (each team's score
     out of 100).
   - Clicking a tab opens it (only one open at a time; the busiest live server is open by default):
     the banner grows, and it shows the **round headline** and the top 3 players this round.
   - Offline servers are greyed and cannot open.
   - A link to each server's page lives in the opened tab.
3. **Below the band:** full-width row of cards (three columns on desktop, two on tablet, one on phone):
   Top dogs (top 3 this week by K/D with rank badges and movement arrows), Just finished (recent rounds
   with three scores and a closeness chip), Kill feed. Each card links to its full page.

**Round headline.** One short generated sentence describing the live state of a round, e.g.
"Manticore are 18 points from taking it." or "Dead even on Ozeti." Built from data already on hand
(scores, gap to 100, leader, top killer); template-based, no AI calls. The exact templates are left to
the builder; they must be factual, never insulting to a player, and fall back to a plain
"Manticore lead 82–61–34" when nothing interesting applies.

### Where today's other home-page panels go (decided)

Each moves to where it belongs; the Live page stays as above.

| Today on home | New home |
|---|---|
| Network summary (players online, servers up) | Header line of the server-tabs card, e.g. "101 playing · 3 of 4 up" |
| Friends online | Small name pills inside the server tab they're on ("Moth, Ashe are here"), plus a list in the You menu. Existing "hide where I'm playing" masking applies to both |
| Most kills 7d and Best K/D 7d | Merged into the Top dogs card with a K/D · Kills pill switch |
| 24h network population chart | The Servers page (`/servers`) |
| Faction wins, 7 days | Top of the Matches page (`/matches`) |

## Other pages (decided in principle)

- Same header, background scene and card material. Content starts directly under the header (no empty
  top window; that is a Live-page feature).
- Restyle in place: existing panels become chunky cards, existing tables become rows inside cards
  (the mockup's leaderboard: pill filters for metric/period/server, each table row its own rounded
  strip, the viewer's own row highlighted). Where a page today stacks many equal panels (the server page
  has 12, the profile 8), the builder should give the page one clear lead card and let the rest follow
  in uneven columns, rather than a uniform grid.
- Leaderboards gains the Skill tab; profiles gain the Compare button.

## The scene (decided)

A toon-shaded diorama, rendered with three.js into one fixed full-viewport canvas behind all content.

- **Look:** flat 3-step cartoon shading with 3px-feel black outlines (inverted-hull) to match the card
  edges. Sunset sky as a CSS gradient behind a transparent canvas (indigo at the top, through purple, to
  warm pink/orange at the bottom), faint stars in the upper part. Warm sun and hemisphere light.
- **Island:** a floating island (grassy top, rocky cone underneath, a few loose rocks below it) with a
  small town, a tall tower, trees, three faction flags waving on rooftops, a jeep driving a ring road.
  Chunky outlined clouds drift slowly under the island and in the distance. The island bobs very gently.
- **The loop (~20s):** a **black** helicopter circles the town; a missile launcher on the green tracks
  it, fires; the missile homes in trailing white smoke and takes off the tail rotor (the tail falls
  away separately); the helicopter spins in and crashes into the tower; the tower top blows off, debris
  scatters and settles, fire and smoke pour out for a few seconds; reset.
- **Camera:** essentially still. A very slow drift, a slight nudge following the mouse, a small shake on
  hits. No orbiting.
- **Framing:** on the Live page the island is centred in the empty area left of the server-tabs card
  (the mockup computes the view offset from that area's position). On other pages it sits centred
  behind the content. Changing framing between pages should ease, not jump.
- **Persistence:** the canvas lives in the root layout, so client-side navigation never remounts it and
  the loop continues across tabs.
- **Reduced motion:** one still frame (helicopter mid-circle), no loop.
- **Fallback:** if WebGL is unavailable the sky gradient alone shows; nothing breaks.

## Page transitions (decided)

On navigation between pages, the outgoing page's cards swipe out to the left and the incoming page's
cards swipe in from the right, with a bouncy (slight overshoot) easing and a small stagger between
cards. The header, bottom tab bar and scene stay put. Next 16's App Router supports React's
`<ViewTransition>` with no config (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`);
using it is the expected route. Browsers without support simply navigate without the animation.
Reduced motion: no swipe.

## Release (decided)

Ships all at once: one branch, one PR, one deploy. No mixed old/new styling on the live site, so no
temporary compatibility layer between the old and new component styles is needed.

## Left to the builder

- Component and file structure, and how far to refactor `src/components/ui.tsx` versus replace it.
- Whether three.js loads lazily after first paint (recommended) and how to keep its cost low on phones
  (pixel ratio cap, pausing when the tab is hidden).
- Exact headline templates, exact animation timings and easing curves, stagger amounts.
- Font loading through `next/font` (as today) and removal of the old fonts.
- How folded pages (`/skill`, `/compare`) are redirected or kept.
- The OG/share card image (`src/components/og-card.tsx`) and `public/offline.html` should match the new
  palette; how closely is the builder's call.

## Builder's calls made during brainstorming (owner to check)

- The online-count pill leaves the header; the same number appears in the server-tabs card header.
- The friend-news badge moves to the You pill.
- The busiest live server's tab is open by default.
- Top dogs shows movement arrows only where the data already exists (the all-time board's daily
  snapshot, `src/lib/server/trends.ts`). A weekly Top dogs card shows no arrows; no new snapshot job.
- The card swipe runs only when the pathname changes (moving between pages). Filter pills, pagination,
  query-string changes and `AutoRefresh`'s `router.refresh()` never trigger it.
