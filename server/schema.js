import { MAX_MEMBERS } from './config.js';

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS groups (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_edit timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY,
    group_id text NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    slot smallint NOT NULL CHECK (slot BETWEEN 1 AND ${MAX_MEMBERS}),
    name text NOT NULL,
    work_postal text NOT NULL,
    work_lat double precision NOT NULL,
    work_lng double precision NOT NULL,
    home_postal text NOT NULL,
    home_lat double precision NOT NULL,
    home_lng double precision NOT NULL,
    key_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (group_id, slot)
  )`,
  'CREATE INDEX IF NOT EXISTS groups_expires_idx ON groups (expires_at)',
  `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket text PRIMARY KEY,
    n integer NOT NULL,
    expires_at timestamptz NOT NULL
  )`,
];

const done = new WeakMap();

// Creates the tables on first use of a database handle (safe to repeat).
export function ensureSchema(db) {
  if (!done.has(db)) {
    const p = (async () => {
      for (const sql of STATEMENTS) await db.query(sql, []);
    })();
    p.catch(() => done.delete(db));
    done.set(db, p);
  }
  return done.get(db);
}
