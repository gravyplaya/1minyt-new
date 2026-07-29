import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA_SQL } from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __oneMinytDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const fromEnv = process.env.DATABASE_PATH?.trim();
  if (fromEnv) return fromEnv;
  // Default: <repo>/data/1minyt.db
  const cwd = process.cwd();
  return path.join(cwd, 'data', '1minyt.db');
}

export function getDb(): Database.Database {
  if (global.__oneMinytDb) return global.__oneMinytDb;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);

  // Seed the default folders the first time the DB is opened.
  const count = (db.prepare('SELECT COUNT(*) as n FROM folders').get() as { n: number }).n;
  if (count === 0) {
    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO folders (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('seed-watch-later', 'Watch Later', '#5b9eff', 0, now);
    insert.run('seed-reference',    'Reference',    '#7c5cff', 1, now);
  }

  global.__oneMinytDb = db;
  return db;
}