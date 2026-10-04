#!/usr/bin/env node
// Consistent online backup of the SQLite database, safe while the site is running.
//
//   node scripts/backup.mjs [dir]          (default dir: $BACKUP_DIR or ./backups)
//   docker compose exec stats node scripts/backup.mjs
//
// Writes teg-wardogs-YYYYMMDD-HHMMSS.db.gz and keeps the newest $BACKUP_KEEP (default 14).
// Plain JS on purpose: it runs inside the production image, which has no TypeScript tooling.

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';

const src = path.resolve(process.env.DATABASE_PATH ?? 'data/teg-wardogs.db');
const dir = path.resolve(process.argv[2] ?? process.env.BACKUP_DIR ?? 'backups');
const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14));

if (!fs.existsSync(src)) {
  console.error(`No database at ${src}`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const tmp = path.join(dir, `.teg-wardogs-${stamp}.db`);
const out = path.join(dir, `teg-wardogs-${stamp}.db.gz`);

const conn = new Database(src, { fileMustExist: true });
conn.pragma('busy_timeout = 10000');
try {
  await conn.backup(tmp);
} finally {
  conn.close();
}
await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(out, { mode: 0o640 }));
fs.rmSync(tmp);

const old = fs
  .readdirSync(dir)
  .filter((f) => /^teg-wardogs-\d{8}-\d{6}\.db\.gz$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f));

const mb = (fs.statSync(out).size / 1e6).toFixed(1);
console.log(`Backed up ${src} -> ${out} (${mb} MB)${old.length ? `, pruned ${old.length}` : ''}`);
