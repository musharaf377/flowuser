const auth = require('./auth');
const { httpError } = require('./router');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ---- body parsing ----
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 1024 * 1024; // 1MB
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(httpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(httpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function jsonBody(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'DELETE') {
    req.body = {};
    return next();
  }
  req.body = await readJsonBody(req);
  next();
}

// ---- CORS (public API is called from arbitrary Webflow domains) ----
function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
}

// ---- basic security headers ----
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

// ---- simple in-memory rate limiter (per IP, per route group) ----
function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map(); // key -> [timestamps]
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.method}:${req.url.split('?')[0]}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) {
      return next(httpError(429, 'Too many requests, slow down.'));
    }
    next();
  };
}

// ---- owner auth ----
function requireOwnerAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && auth.verify(token, JWT_SECRET);
  if (!payload || payload.type !== 'owner') {
    return next(httpError(401, 'Not authenticated'));
  }
  req.owner = { id: payload.sub, email: payload.email };
  next();
}

// ---- resolve a site from its public key (path param) ----
function loadSiteByPublicKey(req, res, next) {
  const site = db.get('SELECT * FROM sites WHERE public_key = ?', [req.params.publicKey]);
  if (!site) return next(httpError(404, 'Unknown site'));
  req.site = site;
  next();
}

// ---- member auth, scoped to the resolved site ----
function requireMemberAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && auth.verify(token, JWT_SECRET);
  if (!payload || payload.type !== 'member' || payload.siteId !== req.site.id) {
    return next(httpError(401, 'Not authenticated'));
  }
  const member = db.get('SELECT * FROM members WHERE id = ? AND site_id = ?', [
    payload.sub,
    req.site.id,
  ]);
  if (!member) return next(httpError(401, 'Not authenticated'));
  req.member = member;
  next();
}

// same as above, but doesn't fail if there's no token (member optional)
function optionalMemberAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && auth.verify(token, JWT_SECRET);
  if (payload && payload.type === 'member' && payload.siteId === req.site.id) {
    req.member = db.get('SELECT * FROM members WHERE id = ? AND site_id = ?', [
      payload.sub,
      req.site.id,
    ]);
  }
  next();
}

module.exports = {
  JWT_SECRET,
  jsonBody,
  cors,
  securityHeaders,
  rateLimit,
  requireOwnerAuth,
  loadSiteByPublicKey,
  requireMemberAuth,
  optionalMemberAuth,
};
