const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const { JWT_SECRET, requireOwnerAuth } = require('../middleware');
const { DEFAULT_PLAN, PAID_PLANS } = require('../plans');

const router = new Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SUPER_ADMIN_EMAILS is a comma-separated env var (e.g. "you@example.com").
// Any owner whose email matches is auto-promoted to super admin on
// signup/login — no manual DB edit or admin UI needed to grant the role.
function isSuperAdminEmail(email) {
  const list = (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

// A paid plan bought via billing.js only lasts PLAN_DURATION_MS (SSLCommerz's
// basic checkout is a one-time charge, not auto-recurring — see plans.js).
// Called wherever an owner row is loaded somewhere the *current* plan
// matters, so an expired plan reliably downgrades back to Free in the DB
// instead of silently staying "pro" forever after the access period ends.
async function syncOwnerPlan(owner) {
  if (PAID_PLANS.includes(owner.plan) && owner.plan_expires_at && owner.plan_expires_at < Date.now()) {
    await db.run('UPDATE owners SET plan = ?, plan_expires_at = NULL WHERE id = ?', [DEFAULT_PLAN, owner.id]);
    owner.plan = DEFAULT_PLAN;
    owner.plan_expires_at = null;
  }
  return owner;
}

function ownerOut(owner) {
  return {
    id: owner.id,
    email: owner.email,
    plan: owner.plan,
    planExpiresAt: owner.plan_expires_at || null,
    isSuperAdmin: !!owner.is_super_admin,
  };
}

router.post('/api/owner/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !EMAIL_RE.test(email)) throw httpError(400, 'Valid email required');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters');

  const existing = await db.get('SELECT id FROM owners WHERE email = ?', [email.toLowerCase()]);
  if (existing) throw httpError(409, 'An account with this email already exists');

  const id = auth.randomId('own_');
  const lowerEmail = email.toLowerCase();
  const isSuperAdmin = isSuperAdminEmail(lowerEmail);
  await db.run(
    'INSERT INTO owners (id, email, password_hash, is_super_admin, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, lowerEmail, auth.hashPassword(password), isSuperAdmin ? 1 : 0, Date.now()]
  );

  const token = auth.sign({ sub: id, email: lowerEmail, type: 'owner' }, JWT_SECRET);
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: ownerOut({ id, email: lowerEmail, plan: DEFAULT_PLAN, is_super_admin: isSuperAdmin }) }));
});

router.post('/api/owner/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password required');

  let owner = await db.get('SELECT * FROM owners WHERE email = ?', [String(email).toLowerCase()]);
  if (!owner || !auth.verifyPassword(password, owner.password_hash)) {
    throw httpError(401, 'Invalid email or password');
  }

  // pick up SUPER_ADMIN_EMAILS changes for accounts that already existed
  if (isSuperAdminEmail(owner.email) && !owner.is_super_admin) {
    await db.run('UPDATE owners SET is_super_admin = 1 WHERE id = ?', [owner.id]);
    owner.is_super_admin = 1;
  }
  owner = await syncOwnerPlan(owner);

  const token = auth.sign({ sub: owner.id, email: owner.email, type: 'owner' }, JWT_SECRET);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: ownerOut(owner) }));
});

router.get('/api/owner/me', requireOwnerAuth, async (req, res) => {
  let owner = await db.get('SELECT id, email, plan, plan_expires_at, is_super_admin FROM owners WHERE id = ?', [
    req.owner.id,
  ]);
  if (!owner) throw httpError(404, 'Owner not found');
  owner = await syncOwnerPlan(owner);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ owner: ownerOut(owner) }));
});

module.exports = router;
module.exports.isSuperAdminEmail = isSuperAdminEmail;
module.exports.syncOwnerPlan = syncOwnerPlan;
module.exports.ownerOut = ownerOut;
