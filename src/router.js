// router.js — a tiny Express-like router built on node:http only.

class Router {
  constructor() {
    this.routes = []; // { method, pattern: RegExp, keys: [], handlers: [] }
  }

  _add(method, path, handlers) {
    const keys = [];
    const pattern = new RegExp(
      '^' +
        path
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$'
    );
    this.routes.push({ method, pattern, keys, handlers });
  }

  get(path, ...handlers) { this._add('GET', path, handlers); }
  post(path, ...handlers) { this._add('POST', path, handlers); }
  patch(path, ...handlers) { this._add('PATCH', path, handlers); }
  delete(path, ...handlers) { this._add('DELETE', path, handlers); }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    req.query = Object.fromEntries(url.searchParams);

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;

      req.params = {};
      route.keys.forEach((key, i) => { req.params[key] = match[i + 1]; });

      let i = 0;
      const next = async (err) => {
        if (err) return sendError(res, err);
        const handler = route.handlers[i++];
        if (!handler) return;
        try {
          await handler(req, res, next);
        } catch (e) {
          sendError(res, e);
        }
      };
      await next();
      return true;
    }
    return false;
  }
}

function sendError(res, err) {
  if (res.headersSent) return;
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: err.publicMessage || err.message || 'Internal error' }));
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}

module.exports = { Router, sendError, httpError };
