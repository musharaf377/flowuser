// db.postgres.js — Postgres storage backend.
//
// db.js picks this automatically when DATABASE_URL is set (see db.js) — no
// manual require-swapping needed. Mirrors db.sqlite.js's exports (run/get/
// all), just async since the `pg` driver is async.

const { Pool, types } = require('pg');

// pg returns BIGINT (OID 20) as a string by default, to avoid silent
// precision loss outside JS's safe integer range. Every BIGINT column in
// this app is an epoch-ms timestamp, which fits safely in a JS number
// (safe up to year ~285,000), so parse it as one — otherwise things like
// `new Date(row.createdAt)` silently produce "Invalid Date" instead of
// throwing, since Date's single-arg constructor treats a numeric STRING as
// a date string to parse, not a timestamp to use.
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }, // Neon/Render both require SSL
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at BIGINT,
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL
  );
  ALTER TABLE owners ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE owners ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE owners ADD COLUMN IF NOT EXISTS plan_expires_at BIGINT;

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES owners(id),
    name TEXT NOT NULL,
    public_key TEXT UNIQUE NOT NULL,
    secret_key TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at BIGINT NOT NULL,
    UNIQUE(site_id, email)
  );

  CREATE TABLE IF NOT EXISTS content_blocks (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    key TEXT NOT NULL,
    plan_required TEXT NOT NULL DEFAULT 'free',
    body TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    UNIQUE(site_id, key)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES owners(id),
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BDT',
    tran_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    val_id TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`;

let ready = pool.query(SCHEMA).catch((e) => {
  console.error('Failed to initialize Postgres schema:', e);
});

// db.js's sqlite functions take positional `?` placeholders; Postgres uses
// $1, $2, ... — this helper converts so the rest of the app (which was
// written against db.js) doesn't need to change its SQL strings.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function run(sql, params = []) {
  await ready;
  const result = await pool.query(toPgSql(sql), params);
  return { changes: result.rowCount };
}

async function get(sql, params = []) {
  await ready;
  const result = await pool.query(toPgSql(sql), params);
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  await ready;
  const result = await pool.query(toPgSql(sql), params);
  return result.rows;
}

module.exports = { pool, run, get, all };

// NOTE: db.js's functions are synchronous (better-sqlite3-style); this
// file's are async (Promises), because the `pg` driver is async. If you
// switch to this file, add `await` in front of every db.run/db.get/db.all
// call across the route files (owner.js, sites.js, member.js).
