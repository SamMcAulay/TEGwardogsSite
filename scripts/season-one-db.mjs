// Builds data/season-one.db from scripts/season-one.sql's output ("steam_id<TAB>json" per line on
// stdin): one row per player, its JSON deflated (a profile inflates one row; whole, the file is ~35 MB),
// and each player's per-server totals as plain rows, which a season-two leaderboard reads a server at a time. The site reads it from DATA_DIR; see
// docs/DEPLOYMENT.md, "Season one stats".
//   ssh … psql -At -F $'\t' < scripts/season-one.sql | node scripts/season-one-db.mjs data/season-one.db
import { rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';

const RIVALS = 50;
const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/season-one-db.mjs <out.db> < season-one.tsv');
rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec('CREATE TABLE players (steam_id TEXT PRIMARY KEY, data BLOB NOT NULL)');
db.exec(`CREATE TABLE boards (server_id TEXT NOT NULL, steam_id TEXT NOT NULL, seconds INTEGER NOT NULL, kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL, headshots INTEGER NOT NULL, matches INTEGER NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL,
  draws INTEGER NOT NULL, cash INTEGER NOT NULL, PRIMARY KEY (server_id, steam_id))`);
const put = db.prepare('INSERT INTO players VALUES (?, ?)');
const putBoard = db.prepare('INSERT INTO boards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
let n = 0;
db.exec('BEGIN');
for await (const line of createInterface({ input: process.stdin })) {
  if (!line) continue;
  const tab = line.indexOf('\t');
  const steamId = line.slice(0, tab);
  if (!/^\d{17}$/.test(steamId)) throw new Error(`bad line ${n + 1}: ${line.slice(0, 40)}`);
  const p = JSON.parse(line.slice(tab + 1));
  // A profile shows five rivals; fifty is plenty to take season one off an all-time top five.
  p.victims = p.victims.slice(0, RIVALS);
  p.nemeses = p.nemeses.slice(0, RIVALS);
  put.run(steamId, deflateRawSync(JSON.stringify(p)));
  for (const [serverId, ...nums] of p.servers) putBoard.run(serverId, steamId, ...nums.map((v) => Math.round(Number(v) || 0)));
  n++;
}
db.exec('COMMIT');
db.exec('VACUUM');
db.close();
if (n < 1000) throw new Error(`only ${n} players: is that the right database?`);
console.log(`${out}: ${n} players`);
