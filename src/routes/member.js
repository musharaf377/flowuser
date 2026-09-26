// Public API — called directly from the browser on the customer's Webflow
// site, scoped by the site's public key in the URL.

const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const {
  JWT_SECRET,
  loadSiteByPublicKey,
  requireMemberAuth,
  optionalMemberAuth,
} = require('../middleware');
const { getPlan } = require('../plans');

const router = new Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PLAN_RANK = { free: 0 }; // any plan name not listed here ranks above 'free'
function planSatisfies(memberPlan, required) {
  if (!required || required === 'free') return true;
  return memberPlan === required || (memberPlan && memberPlan !== 'free' && required === 'any');
}

function memberOut(m) {
  return { id: m.id, email: m.email, plan: m.plan, createdAt: m.created_at };
}

router.post('/api/m/:publicKey/signup', loadSiteByPublicKey, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !EMAIL_RE.test(email)) throw httpError(400, 'Valid email required');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters');

  const existing = await db.get('SELECT id FROM members WHERE site_id = ? AND email = ?', [
    req.site.id,
    email.toLowerCase(),
  ]);
  if (existing) throw httpError(409, 'An account with this email already exists');

  const owner = await db.get('SELECT plan FROM owners WHERE id = ?', [req.site.owner_id]);
  const plan = getPlan(owner.plan);
  const { count } = await db.get('SELECT COUNT(*) as count FROM members WHERE site_id = ?', [req.site.id]);
  if (count >= plan.maxMembersPerSite) {
    throw httpError(403, 'This site has reached its member limit for the current plan. Contact the site owner.');
  }

  const id = auth.randomId('mem_');
  await db.run(
    'INSERT INTO members (id, site_id, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.site.id, email.toLowerCase(), auth.hashPassword(password), 'free', Date.now()]
  );

  const member = await db.get('SELECT * FROM members WHERE id = ?', [id]);
  const token = auth.sign({ sub: id, siteId: req.site.id, type: 'member' }, JWT_SECRET);
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, member: memberOut(member) }));
});

router.post('/api/m/:publicKey/login', loadSiteByPublicKey, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password required');

  const member = await db.get('SELECT * FROM members WHERE site_id = ? AND email = ?', [
    req.site.id,
    String(email).toLowerCase(),
  ]);
  if (!member || !auth.verifyPassword(password, member.password_hash)) {
    throw httpError(401, 'Invalid email or password');
  }

  const token = auth.sign({ sub: member.id, siteId: req.site.id, type: 'member' }, JWT_SECRET);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, member: memberOut(member) }));
});

router.get('/api/m/:publicKey/me', loadSiteByPublicKey, requireMemberAuth, async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ member: memberOut(req.member) }));
});

// Public — just the site's display name, so a member-facing page (e.g. the
// member dashboard) can greet visitors by site instead of looking generic.
// Nothing sensitive: a visitor on the Webflow site already sees this name.
router.get('/api/m/:publicKey/site', loadSiteByPublicKey, async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name: req.site.name }));
});

// List content blocks for the member dashboard. Locked blocks' bodies are
// withheld (same boundary as the single-block fetch below) — only the key
// and the plan required are exposed, so a member can see what upgrading
// would unlock without the actual premium content leaking.
router.get(
  '/api/m/:publicKey/content',
  loadSiteByPublicKey,
  optionalMemberAuth,
  async (req, res) => {
    const blocks = await db.all('SELECT * FROM content_blocks WHERE site_id = ? ORDER BY created_at DESC', [
      req.site.id,
    ]);
    const memberPlan = req.member ? req.member.plan : null;
    const out = blocks.map((b) => {
      const unlocked = planSatisfies(memberPlan, b.plan_required);
      return {
        key: b.key,
        planRequired: b.plan_required,
        unlocked,
        body: unlocked ? b.body : null,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ blocks: out }));
  }
);

// Gated content: the SDK fetches this instead of relying on client-side
// hide/show, so the actual protected text never reaches a visitor's browser
// unless their plan qualifies. This is the real security boundary.
router.get(
  '/api/m/:publicKey/content/:key',
  loadSiteByPublicKey,
  optionalMemberAuth,
  async (req, res) => {
    const block = await db.get('SELECT * FROM content_blocks WHERE site_id = ? AND key = ?', [
      req.site.id,
      req.params.key,
    ]);
    if (!block) throw httpError(404, 'No such content block');

    const memberPlan = req.member ? req.member.plan : null;
    const allowed = planSatisfies(memberPlan, block.plan_required);
    if (!allowed) throw httpError(403, 'Upgrade required to view this content');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: block.key, body: block.body }));
  }
);

module.exports = router;
