const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const { JWT_SECRET, requireOwnerAuth } = require('../middleware');
const { DEFAULT_PLAN } = require('../plans');

const router = new Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/api/owner/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !EMAIL_RE.test(email)) throw httpError(400, 'Valid email required');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters');

  const existing = await db.get('SELECT id FROM owners WHERE email = ?', [email.toLowerCase()]);
  if (existing) throw httpError(409, 'An account with this email already exists');

  const id = auth.randomId('own_');
  await db.run('INSERT INTO owners (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    email.toLowerCase(),
    auth.hashPassword(password),
    Date.now(),
  ]);

  const token = auth.sign({ sub: id, email: email.toLowerCase(), type: 'owner' }, JWT_SECRET);
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: { id, email: email.toLowerCase(), plan: DEFAULT_PLAN } }));
});

router.post('/api/owner/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password required');

  const owner = await db.get('SELECT * FROM owners WHERE email = ?', [String(email).toLowerCase()]);
  if (!owner || !auth.verifyPassword(password, owner.password_hash)) {
    throw httpError(401, 'Invalid email or password');
  }

  const token = auth.sign({ sub: owner.id, email: owner.email, type: 'owner' }, JWT_SECRET);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: { id: owner.id, email: owner.email, plan: owner.plan } }));
});

router.get('/api/owner/me', requireOwnerAuth, async (req, res) => {
  const owner = await db.get('SELECT id, email, plan FROM owners WHERE id = ?', [req.owner.id]);
  if (!owner) throw httpError(404, 'Owner not found');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ owner }));
});

module.exports = router;
