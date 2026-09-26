// db.sqlite.js — local storage backend, using Node's built-in `node:sqlite`
// (zero cost, zero setup, a single file on disk).
//
// This is picked automatically by db.js when DATABASE_URL isn't set — good
// for local dev, but NOT for Render's free tier: that disk is ephemeral and
// gets wiped on every redeploy/restart, so any data stored here disappears.
// For anything you want to keep, set DATABASE_URL (see db.postgres.js) and
// db.js will route to Postgres instead — no other code needs to change.

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'flowmember.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    public_key TEXT UNIQUE NOT NULL,
    secret_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at INTEGER NOT NULL,
    UNIQUE(site_id, email),
    FOREIGN KEY (site_id) REFERENCES sites(id)
  );

  CREATE TABLE IF NOT EXISTS content_blocks (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    key TEXT NOT NULL,
    plan_required TEXT NOT NULL DEFAULT 'free',
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE(site_id, key),
    FOREIGN KEY (site_id) REFERENCES sites(id)
  );
`);

// migrate: databases created before these owners columns existed
const ownerColumns = db.prepare("PRAGMA table_info(owners)").all();
if (!ownerColumns.some((c) => c.name === 'plan')) {
  db.exec("ALTER TABLE owners ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
}
if (!ownerColumns.some((c) => c.name === 'is_super_admin')) {
  db.exec("ALTER TABLE owners ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0");
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params) || null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

module.exports = { db, run, get, all };
