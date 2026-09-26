const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const { JWT_SECRET } = require('../middleware');

const router = new Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/api/owner/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !EMAIL_RE.test(email)) throw httpError(400, 'Valid email required');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters');

  const existing = db.get('SELECT id FROM owners WHERE email = ?', [email.toLowerCase()]);
  if (existing) throw httpError(409, 'An account with this email already exists');

  const id = auth.randomId('own_');
  db.run('INSERT INTO owners (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    email.toLowerCase(),
    auth.hashPassword(password),
    Date.now(),
  ]);

  const token = auth.sign({ sub: id, email: email.toLowerCase(), type: 'owner' }, JWT_SECRET);
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: { id, email: email.toLowerCase() } }));
});

router.post('/api/owner/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password required');

  const owner = db.get('SELECT * FROM owners WHERE email = ?', [String(email).toLowerCase()]);
  if (!owner || !auth.verifyPassword(password, owner.password_hash)) {
    throw httpError(401, 'Invalid email or password');
  }

  const token = auth.sign({ sub: owner.id, email: owner.email, type: 'owner' }, JWT_SECRET);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, owner: { id: owner.id, email: owner.email } }));
});

module.exports = router;
