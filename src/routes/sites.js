const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const { requireOwnerAuth } = require('../middleware');
const { getEffectivePlan } = require('../plans');

const router = new Router();

// all routes here belong to the authenticated owner
router.post('/api/sites', requireOwnerAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw httpError(400, 'Site name is required');

  const owner = await db.get('SELECT plan, is_super_admin FROM owners WHERE id = ?', [req.owner.id]);
  const plan = getEffectivePlan(owner);
  const { count } = await db.get('SELECT COUNT(*) as count FROM sites WHERE owner_id = ?', [req.owner.id]);
  if (count >= plan.maxSites) {
    throw httpError(
      403,
      `Your ${plan.name} plan allows up to ${plan.maxSites} site${plan.maxSites === 1 ? '' : 's'}. Upgrade to add more.`
    );
  }

  const id = auth.randomId('site_');
  const publicKey = auth.randomKey(12); // safe to expose in front-end embed code
  const secretKey = auth.randomKey(24); // never expose this one

  await db.run(
    'INSERT INTO sites (id, owner_id, name, public_key, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.owner.id, name.trim(), publicKey, secretKey, Date.now()]
  );

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id, name: name.trim(), publicKey, secretKey }));
});

router.get('/api/sites', requireOwnerAuth, async (req, res) => {
  const sites = await db.all(
    'SELECT id, name, public_key as publicKey, created_at as createdAt FROM sites WHERE owner_id = ? ORDER BY created_at DESC',
    [req.owner.id]
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ sites }));
});

async function loadOwnedSite(req) {
  const site = await db.get('SELECT * FROM sites WHERE id = ? AND owner_id = ?', [
    req.params.id,
    req.owner.id,
  ]);
  if (!site) throw httpError(404, 'Site not found');
  return site;
}

router.get('/api/sites/:id/members', requireOwnerAuth, async (req, res) => {
  const site = await loadOwnedSite(req);
  const members = await db.all(
    'SELECT id, email, plan, created_at as createdAt FROM members WHERE site_id = ? ORDER BY created_at DESC',
    [site.id]
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ members }));
});

router.patch('/api/sites/:id/members/:memberId', requireOwnerAuth, async (req, res) => {
  const site = await loadOwnedSite(req);
  const { plan } = req.body;
  if (!plan || !plan.trim()) throw httpError(400, 'plan is required');

  const member = await db.get('SELECT id FROM members WHERE id = ? AND site_id = ?', [
    req.params.memberId,
    site.id,
  ]);
  if (!member) throw httpError(404, 'Member not found');

  await db.run('UPDATE members SET plan = ? WHERE id = ?', [plan.trim(), member.id]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

// Overview stats for the per-site dashboard. Computed in JS from a single
// query rather than backend-specific SQL date functions, so this works
// identically against both the SQLite and Postgres storage backends.
router.get('/api/sites/:id/stats', requireOwnerAuth, async (req, res) => {
  const site = await loadOwnedSite(req);
  const [members, contentBlockCount] = await Promise.all([
    db.all('SELECT email, plan, created_at as createdAt FROM members WHERE site_id = ? ORDER BY created_at DESC', [
      site.id,
    ]),
    db.get('SELECT COUNT(*) as count FROM content_blocks WHERE site_id = ?', [site.id]),
  ]);

  const planBreakdown = {};
  for (const m of members) {
    planBreakdown[m.plan] = (planBreakdown[m.plan] || 0) + 1;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff30d = Date.now() - 30 * DAY_MS;
  const signups30d = members.filter((m) => m.createdAt >= cutoff30d).length;

  // last 14 calendar days (UTC), oldest first, zero-filled
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dailyCounts = {};
  for (let i = 13; i >= 0; i--) {
    dailyCounts[dayKey(Date.now() - i * DAY_MS)] = 0;
  }
  for (const m of members) {
    const key = dayKey(m.createdAt);
    if (key in dailyCounts) dailyCounts[key]++;
  }
  const dailySignups = Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      totalMembers: members.length,
      signups30d,
      planBreakdown,
      contentBlockCount: contentBlockCount.count,
      dailySignups,
      recentSignups: members.slice(0, 8),
    })
  );
});

router.get('/api/sites/:id/content', requireOwnerAuth, async (req, res) => {
  const site = await loadOwnedSite(req);
  const blocks = await db.all(
    'SELECT id, key, plan_required as planRequired, body, created_at as createdAt FROM content_blocks WHERE site_id = ? ORDER BY created_at DESC',
    [site.id]
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ blocks }));
});

router.post('/api/sites/:id/content', requireOwnerAuth, async (req, res) => {
  const site = await loadOwnedSite(req);
  const { key, planRequired, body } = req.body;
  if (!key || !key.trim()) throw httpError(400, 'key is required');

  const existing = await db.get('SELECT id FROM content_blocks WHERE site_id = ? AND key = ?', [
    site.id,
    key.trim(),
  ]);

  if (existing) {
    await db.run('UPDATE content_blocks SET plan_required = ?, body = ? WHERE id = ?', [
      planRequired || 'free',
      body || '',
      existing.id,
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: existing.id, ok: true }));
    return;
  }

  const id = auth.randomId('blk_');
  await db.run(
    'INSERT INTO content_blocks (id, site_id, key, plan_required, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, site.id, key.trim(), planRequired || 'free', body || '', Date.now()]
  );
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id, ok: true }));
});

module.exports = router;
