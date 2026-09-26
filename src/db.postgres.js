// db.postgres.js — REFERENCE FILE for when you buy real hosting.
//
// This is NOT wired in yet. It mirrors db.js's exports (run/get/all) but
// talks to Postgres instead of the local SQLite file, so the rest of the
// app doesn't need to change — you just swap which file gets required.
//
// To switch to this:
//   1. On your own machine (not needed in this sandbox), run:
//        npm install pg
//   2. Set DATABASE_URL in your .env, e.g. the connection string Neon or
//      Render Postgres gives you (postgres://user:pass@host/dbname).
//   3. In every file that does `require('./db')` or `require('../db')`,
//      point it at this file instead (or rename this file to db.js and
//      rename the old one to db.sqlite.js — either works).
//
// This file has not been run against a live Postgres instance in this
// session (outbound Postgres connections aren't reachable from this
// sandbox), but it uses the standard, well-documented `pg` API — test it
// against your own Neon/Render database before relying on it.

const { Pool } = require('pg');

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
    created_at BIGINT NOT NULL
  );
  ALTER TABLE owners ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

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
