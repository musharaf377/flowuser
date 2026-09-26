// db.js — picks the storage backend at startup.
//
// DATABASE_URL set (a Neon/Render Postgres connection string) -> Postgres,
// which survives restarts and redeploys. Otherwise -> local SQLite, which is
// fine for local dev but is wiped on Render's free tier every time the
// service redeploys or sleeps/wakes (its disk is ephemeral).
//
// Postgres's run/get/all are async (return Promises); SQLite's are sync.
// Every call site uses `await db.run(...)` etc. so it works against either
// backend — `await` on a non-Promise value just resolves immediately.

module.exports = process.env.DATABASE_URL ? require('./db.postgres') : require('./db.sqlite');
