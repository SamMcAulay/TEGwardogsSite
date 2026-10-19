-- Season one, frozen: every player's stats from before 2026-10-14 00:00 UTC, one JSON object per
-- line ("steam_id<TAB>json"), read from Warcon's database. Each part copies Warcon's own query for
-- the same number (leaderboards.ts `lines`/loadCareer, players.ts dossier and combatSummary) with
-- the cutoff added, so a profile's season two is exactly all time minus this. Warcon's all time
-- leaves out servers deleted from it, so `current` repeats the numbers for the servers it still
-- has: season two is all time less `current`, and all time on the site is season one plus that.
-- Run by scripts/season-one-snapshot.sh; see docs/DEPLOYMENT.md.
\set cutoff '''2026-10-14T00:00:00Z'''
WITH lines AS (
  SELECT p.steam_id, p.match_id, p.server_id, p.faction, p.seconds, p.kills, p.deaths, p.headshots,
         p.vehicle_kills, p.longest_m, p.kill_streak, m.started_at, m.ended_at, m.map,
         p.server_id IN (SELECT id FROM servers) AS cur,
         CASE WHEN p.faction IS NULL THEN NULL
              WHEN jsonb_typeof(m.final_scores) = 'array' AND jsonb_array_length(m.final_scores) > 0
                   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m.final_scores) e WHERE e->>'name' = p.faction)
                   THEN NULL
              WHEN m.winner IS NOT NULL THEN CASE WHEN m.winner = p.faction THEN 'win' ELSE 'loss' END
              WHEN jsonb_typeof(m.final_scores) = 'array'
                   AND (SELECT MAX(CASE WHEN jsonb_typeof(e->'score') = 'number' THEN (e->>'score')::numeric END)
                          FROM jsonb_array_elements(m.final_scores) e) > 0 THEN 'draw'
              ELSE NULL END AS result
    FROM matches m JOIN match_players p ON p.match_id = m.id AND p.server_id = m.server_id
   WHERE m.ended_at IS NOT NULL AND m.started_at < :cutoff
),
-- Every line twice over: once for season one everywhere ('all'), once more if on a current server.
scoped AS (
  SELECT l.*, v.scope FROM lines l CROSS JOIN LATERAL (VALUES ('all'), (CASE WHEN l.cur THEN 'cur' END)) v(scope)
   WHERE v.scope IS NOT NULL
),
totals AS (
  SELECT steam_id, scope, COUNT(*) AS matches, SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(headshots) AS headshots,
         SUM(seconds) AS seconds, SUM(vehicle_kills) AS vehicle_kills, MAX(longest_m) AS longest, MAX(kill_streak) AS kill_streak,
         COUNT(*) FILTER (WHERE result = 'win') AS wins, COUNT(*) FILTER (WHERE result = 'loss') AS losses,
         COUNT(*) FILTER (WHERE result = 'draw') AS draws
    FROM scoped GROUP BY steam_id, scope
),
grouped AS (
  SELECT steam_id, scope, kind, json_agg(json_build_array(key, matches, wins, kills, deaths) ORDER BY matches DESC, key) AS rows
    FROM (SELECT steam_id, scope, 'maps' AS kind, map AS key, COUNT(*) AS matches, COUNT(*) FILTER (WHERE result = 'win') AS wins,
                 SUM(kills) AS kills, SUM(deaths) AS deaths FROM scoped GROUP BY steam_id, scope, map
          UNION ALL
          SELECT steam_id, scope, 'factions', faction, COUNT(*), COUNT(*) FILTER (WHERE result = 'win'), SUM(kills), SUM(deaths)
            FROM scoped GROUP BY steam_id, scope, faction) g
   WHERE key IS NOT NULL GROUP BY steam_id, scope, kind
),
rounds AS (
  SELECT steam_id, json_agg(json_build_array(match_id, server_id, map, extract(epoch FROM started_at)::bigint,
           extract(epoch FROM ended_at)::bigint, faction, result, kills, deaths, seconds) ORDER BY started_at DESC, match_id DESC) AS rows
    FROM (SELECT *, row_number() OVER (PARTITION BY steam_id ORDER BY started_at DESC, match_id DESC) AS n FROM lines) r
   WHERE n <= 10 GROUP BY steam_id
),
feed AS (
  SELECT k.*, v.scope FROM kills k
   CROSS JOIN LATERAL (VALUES ('all'), (CASE WHEN k.server_id IN (SELECT id FROM servers) THEN 'cur' END)) v(scope)
   WHERE k.ts < :cutoff AND v.scope IS NOT NULL
),
combat AS (
  SELECT id AS steam_id, scope, SUM(team_kills) AS team_kills, SUM(suicides) AS suicides FROM (
    SELECT killer_steam_id AS id, scope, COUNT(*) FILTER (WHERE team_kill) AS team_kills, 0 AS suicides FROM feed WHERE killer_steam_id IS NOT NULL GROUP BY 1, 2
    UNION ALL
    SELECT victim_steam_id, scope, 0, COUNT(*) FILTER (WHERE suicide) FROM feed GROUP BY 1, 2) c
   GROUP BY id, scope
),
weapons AS (
  SELECT steam_id, scope, json_agg(json_build_array(cause, n) ORDER BY n DESC, cause) AS rows FROM (
    SELECT killer_steam_id AS steam_id, scope, cause, COUNT(*) AS n FROM feed
     WHERE killer_steam_id IS NOT NULL AND NOT suicide AND cause IS NOT NULL GROUP BY 1, 2, 3) w
   GROUP BY steam_id, scope
),
victims AS (
  SELECT steam_id, scope, json_agg(json_build_array(other, name, n) ORDER BY n DESC, other) AS rows FROM (
    SELECT killer_steam_id AS steam_id, scope, victim_steam_id AS other, MAX(victim_name) AS name, COUNT(*) AS n FROM feed
     WHERE killer_steam_id IS NOT NULL AND NOT suicide GROUP BY 1, 2, 3) v
   GROUP BY steam_id, scope
),
nemeses AS (
  SELECT steam_id, scope, json_agg(json_build_array(other, name, n) ORDER BY n DESC, other) AS rows FROM (
    SELECT victim_steam_id AS steam_id, scope, killer_steam_id AS other, MAX(killer_name) AS name, COUNT(*) AS n FROM feed
     WHERE killer_steam_id IS NOT NULL AND NOT suicide GROUP BY 1, 2, 3) v
   GROUP BY steam_id, scope
),
per_server AS (
  -- One entry per server: [id, seconds, kills, deaths, headshots, matches, wins, losses, draws, cash],
  -- as Warcon's board counts them (time and cash from sessions, the rest from match lines), so a
  -- season-two board is a server's all-time board less these.
  SELECT steam_id, json_agg(json_build_array(server_id, COALESCE(s.seconds, 0), COALESCE(k.kills, 0), COALESCE(k.deaths, 0),
           COALESCE(k.headshots, 0), COALESCE(k.matches, 0), COALESCE(k.wins, 0), COALESCE(k.losses, 0), COALESCE(k.draws, 0), COALESCE(s.cash, 0))
           ORDER BY s.seconds DESC NULLS LAST) AS rows FROM (
    SELECT steam_id, server_id,
           round(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(left_at, now()), :cutoff::timestamptz) - joined_at))))::bigint AS seconds,
           SUM(cash) AS cash
      FROM player_sessions WHERE joined_at < :cutoff GROUP BY 1, 2) s
  FULL JOIN (SELECT steam_id, server_id, SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(headshots) AS headshots, COUNT(*) AS matches,
                    COUNT(*) FILTER (WHERE result = 'win') AS wins, COUNT(*) FILTER (WHERE result = 'loss') AS losses,
                    COUNT(*) FILTER (WHERE result = 'draw') AS draws
               FROM lines GROUP BY 1, 2) k USING (steam_id, server_id)
   GROUP BY steam_id
),
everyone AS (SELECT steam_id FROM totals UNION SELECT steam_id FROM combat UNION SELECT steam_id FROM per_server),
-- A player's numbers for one scope, in the shape the site reads.
part AS (
  SELECT e.steam_id, sc.scope, json_build_object(
           'kills', COALESCE(t.kills, 0), 'deaths', COALESCE(t.deaths, 0), 'headshots', COALESCE(t.headshots, 0),
           'seconds', COALESCE(t.seconds, 0), 'matches', COALESCE(t.matches, 0), 'wins', COALESCE(t.wins, 0),
           'losses', COALESCE(t.losses, 0), 'draws', COALESCE(t.draws, 0), 'vehicleKills', COALESCE(t.vehicle_kills, 0),
           'longest', t.longest, 'killStreak', COALESCE(t.kill_streak, 0),
           'teamKills', COALESCE(c.team_kills, 0), 'suicides', COALESCE(c.suicides, 0),
           'maps', COALESCE(gm.rows, '[]'), 'factions', COALESCE(gf.rows, '[]'),
           'weapons', COALESCE(w.rows, '[]'), 'victims', COALESCE(v.rows, '[]'), 'nemeses', COALESCE(n.rows, '[]')) AS obj
    FROM everyone e CROSS JOIN (VALUES ('all'), ('cur')) sc(scope)
    LEFT JOIN totals t ON t.steam_id = e.steam_id AND t.scope = sc.scope
    LEFT JOIN combat c ON c.steam_id = e.steam_id AND c.scope = sc.scope
    LEFT JOIN grouped gm ON gm.steam_id = e.steam_id AND gm.scope = sc.scope AND gm.kind = 'maps'
    LEFT JOIN grouped gf ON gf.steam_id = e.steam_id AND gf.scope = sc.scope AND gf.kind = 'factions'
    LEFT JOIN weapons w ON w.steam_id = e.steam_id AND w.scope = sc.scope
    LEFT JOIN victims v ON v.steam_id = e.steam_id AND v.scope = sc.scope
    LEFT JOIN nemeses n ON n.steam_id = e.steam_id AND n.scope = sc.scope
)
SELECT e.steam_id,
       (a.obj::jsonb || jsonb_build_object('rounds', COALESCE(r.rows, '[]'), 'servers', COALESCE(s.rows, '[]'), 'current', cu.obj))::json
  FROM everyone e
  JOIN part a ON a.steam_id = e.steam_id AND a.scope = 'all'
  JOIN part cu ON cu.steam_id = e.steam_id AND cu.scope = 'cur'
  LEFT JOIN rounds r ON r.steam_id = e.steam_id
  LEFT JOIN per_server s ON s.steam_id = e.steam_id
 WHERE e.steam_id ~ '^\d{17}$';
