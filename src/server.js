const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

require('./env').load(); // tiny built-in .env loader (no dependency needed)

const { Router } = require('./router');
const { jsonBody, cors, securityHeaders, rateLimit } = require('./middleware');
const ownerRoutes = require('./routes/owner');
const siteRoutes = require('./routes/sites');
const memberRoutes = require('./routes/member');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEMO_DIR = path.join(__dirname, '..', 'demo');

const api = new Router();
api.routes.push(...ownerRoutes.routes);
api.routes.push(...siteRoutes.routes);
api.routes.push(...memberRoutes.routes);

const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(rootDir, urlPrefix) {
  return (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).slice(urlPrefix.length) || '/index.html';
    const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(rootDir, safeRel === '/' ? '/index.html' : safeRel);
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return true;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}

const serveAdmin = serveStatic(path.join(PUBLIC_DIR, 'admin'), '/admin');
const serveSdk = serveStatic(path.join(PUBLIC_DIR, 'sdk'), '/sdk');
const serveDemo = serveStatic(DEMO_DIR, '/demo');
const serveHome = serveStatic(path.join(PUBLIC_DIR, 'home'), '/');

const server = http.createServer(async (req, res) => {
  await new Promise((resolve) => cors(req, res, resolve));
  if (res.writableEnded) return;
  await new Promise((resolve) => securityHeaders(req, res, resolve));

  if (req.url.startsWith('/admin')) return void serveAdmin(req, res);
  if (req.url.startsWith('/sdk')) return void serveSdk(req, res);
  if (req.url.startsWith('/demo')) return void serveDemo(req, res);
  if (req.url === '/' || req.url.startsWith('/?')) return void serveHome(req, res);

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url.startsWith('/api/')) {
    await new Promise((resolve, reject) => jsonBody(req, res, (e) => (e ? reject(e) : resolve())));

    const isAuthRoute = /\/(signup|login)$/.test(req.url.split('?')[0]);
    if (isAuthRoute) {
      const handled = await new Promise((resolve, reject) => {
        authLimiter(req, res, (e) => (e ? reject(e) : resolve(false)));
      }).catch((e) => {
        const { sendError } = require('./router');
        sendError(res, e);
        return true;
      });
      if (handled === true) return;
    }

    const matched = await api.handle(req, res);
    if (!matched) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Try /admin, /sdk/flowmember.js, or /demo');
});

server.listen(PORT, () => {
  console.log(`flowmember server running on http://localhost:${PORT}`);
  console.log(`  admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`  demo page:       http://localhost:${PORT}/demo`);
});

module.exports = server;
