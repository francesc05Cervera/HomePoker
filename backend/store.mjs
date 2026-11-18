import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

function record(room, deck) {
  return JSON.stringify({room, deck});
}

async function postgres(connectionString) {
  const {Pool} = await import('pg');
  const pool = new Pool({connectionString, max:3});
  pool.on('error', error => console.error('Connessione PostgreSQL inattiva:', error.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS homepoker_rooms (
      code text PRIMARY KEY,
      version integer NOT NULL,
      snapshot jsonb NOT NULL
    )
  `);
  return {
    close:() => pool.end(),
    async all() {
      return (await pool.query('SELECT snapshot FROM homepoker_rooms')).rows.map(row => row.snapshot);
    },
    async get(code) {
      return (await pool.query('SELECT snapshot FROM homepoker_rooms WHERE code = $1', [code])).rows[0]?.snapshot;
    },
    async put(room, deck, previous) {
      const fields = [room.code, room.version, record(room,deck)];
      const result = previous === null
        ? await pool.query('INSERT INTO homepoker_rooms VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', fields)
        : await pool.query('UPDATE homepoker_rooms SET version=$2, snapshot=$3 WHERE code=$1 AND version=$4', [...fields,previous]);
      return result.rowCount === 1;
    },
    async remove(code, version) {
      return (await pool.query('DELETE FROM homepoker_rooms WHERE code=$1 AND version=$2', [code,version])).rowCount === 1;
    },
  };
}

async function sqlite(filename) {
  const {DatabaseSync} = await import('node:sqlite');
  if (filename !== ':memory:') await mkdir(dirname(filename), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS homepoker_rooms (
      code TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    );
  `);
  const all = db.prepare('SELECT snapshot FROM homepoker_rooms');
  const get = db.prepare('SELECT snapshot FROM homepoker_rooms WHERE code = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO homepoker_rooms VALUES (?,?,?)');
  const update = db.prepare('UPDATE homepoker_rooms SET version=?, snapshot=? WHERE code=? AND version=?');
  const remove = db.prepare('DELETE FROM homepoker_rooms WHERE code=? AND version=?');
  return {
    close:() => db.close(),
    all:() => all.all().map(row => JSON.parse(row.snapshot)),
    get:code => {const row = get.get(code); return row && JSON.parse(row.snapshot);},
    put(room, deck, previous) {
      const json = record(room,deck);
      const result = previous === null
        ? insert.run(room.code,room.version,json)
        : update.run(room.version,json,room.code,previous);
      return result.changes === 1;
    },
    remove:(code, version) => remove.run(code, version).changes === 1,
  };
}

export async function openStore() {
  if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL);
  const configured = process.env.HOLDEM_DB_PATH;
  if (process.env.RENDER === 'true' && !configured) {
    console.warn('HomePoker usa SQLite temporaneo. Configura DATABASE_URL o un disco persistente per conservare le partite tra deploy.');
    return sqlite(resolve(tmpdir(), 'homepoker.sqlite'));
  }
  const path = configured ?? fileURLToPath(new URL('./data/homepoker.sqlite', import.meta.url));
  return sqlite(path === ':memory:' ? path : resolve(path));
}

