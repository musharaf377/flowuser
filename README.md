# FlowMember

A self-hosted membership / user-management system for Webflow sites — a
Memberstack alternative you own and run yourself. Built because Webflow
sunset its native User Accounts feature (Jan 29, 2026) and Memberstack is
paid.

**Zero external dependencies.** It's plain Node.js (`node:http`,
`node:crypto`, `node:sqlite`) — no `npm install` needed to run it locally or
on most Node hosts. Requires **Node.js 22.5+** (for built-in SQLite).

## What's inside

- `src/` — the backend API (owner accounts, sites, members, plans, gated
  content) and the SQLite storage layer.
- `public/admin/` — a dashboard for you (the site owner): create sites, see
  members, change their plan, define protected content.
- `public/sdk/flowmember.js` — the one script tag you paste into Webflow.
  It handles signup/login forms, shows/hides content by plan, and fetches
  gated content, all through `data-*` attributes — no code to write.
- `demo/index.html` — a fake "Webflow site" so you can try the whole flow
  locally before touching Webflow.

## Run it locally (free, right now)

```bash
node src/server.js
```

Open:
- `http://localhost:3000/admin` — sign up as the site owner, create a site,
  copy the embed snippet.
- `http://localhost:3000/demo` — paste your new site's public key into the
  `data-site-id` attribute at the bottom of `demo/index.html` and reload,
  to try signup/login/gating exactly as a visitor would.

Data is stored in `data/flowmember.sqlite` (created automatically).

Copy `.env.example` to `.env` and set `JWT_SECRET` to a long random string
before you show this to anyone but yourself.

## Put it on your real Webflow site

1. In the admin dashboard, create a site and copy the embed snippet.
2. In Webflow: **Site Settings → Custom Code → Footer Code** (or a single
   page's settings, if you only want it on some pages), paste the snippet.
3. Anywhere in the Webflow Designer, add these attributes to elements —
   no custom code required:

   | What you want | How |
   |---|---|
   | Signup form | `<form data-ms-form="signup">` with `name="email"` / `name="password"` inputs |
   | Login form | `<form data-ms-form="login">` (same inputs) |
   | Logout link | `<a data-ms-logout>` |
   | Show only to logged-in visitors | `data-ms-content="member"` |
   | Show only to logged-out visitors | `data-ms-content="visitor"` |
   | Show only to a specific plan | `data-ms-plan="pro"` |
   | Print the member's email/plan | `<span data-ms-bind="email">`, `data-ms-bind="plan"` |
   | Gated content fetched from the server | `<div data-ms-protected="key" data-ms-fallback="idOfFallbackElement">` |

   In Webflow, these go in the element's **Settings panel → Custom
   Attributes** — no code embed needed for the attributes themselves, only
   for the one script tag in step 2.

4. In the admin dashboard, define protected content blocks (a key, which
   plan it requires, and the HTML to serve) and reference the key with
   `data-ms-protected`. This is the part that's actually secure — the real
   content never reaches a visitor's browser unless their plan qualifies,
   unlike hiding a div with CSS/JS.
5. Manage members and change their plan from the admin dashboard. (Payment
   collection isn't built yet — see "What's not built yet" below.)

## Deploy for free (so it's reachable from your live Webflow site)

**Render.com** (free web service):
1. Push this folder to a GitHub repo.
2. In Render: New → Blueprint → pick the repo (it'll read `render.yaml`).
3. Once deployed, your admin dashboard is at
   `https://your-app.onrender.com/admin`, and the SDK is at
   `https://your-app.onrender.com/sdk/flowmember.js`.

⚠️ **Important limitation of the free tier:** Render's free web services
have an *ephemeral* disk — the SQLite file is wiped whenever the service
redeploys or restarts (including its automatic sleep/wake on the free
plan). This is fine for testing the whole flow live, but **don't rely on it
for real members' data yet.** Two ways to fix this when you're ready:

- **Cheapest fix:** upgrade to Render's smallest paid instance and attach a
  persistent Disk — then your SQLite file survives restarts.
- **Recommended for real use:** switch to a real hosted database. See
  `src/db.postgres.js` — it's a ready-to-go Postgres version of the storage
  layer (works with a free [Neon](https://neon.tech) database). It needs
  `npm install pg` (that install couldn't be tested from this sandbox
  because of network restrictions here, but `pg` is the standard, widely
  used Postgres driver — it will install normally on your machine or on
  Render). To switch: install `pg`, set `DATABASE_URL` in your environment,
  and point the `require('./db')` lines in `src/routes/*.js` and
  `src/server.js` at `db.postgres.js` instead. Note its functions are
  `async` (add `await`), unlike the SQLite version.

## When you're ready to buy real hosting

Nothing here is tied to Render — it's plain Node.js, so it runs the same
way on a VPS (DigitalOcean, Hetzner, etc.), Railway, Fly.io, or your own
server:

```bash
git clone <your-repo>
cd flowmember
node src/server.js        # or: pm2 start src/server.js --name flowmember
```

Put it behind Nginx/Caddy for HTTPS and a real domain, set `JWT_SECRET` and
(if you migrated) `DATABASE_URL` as environment variables, and you're done.

## Security notes

- `data-ms-content` / `data-ms-plan` (show/hide by CSS) are **not** a
  security boundary — a visitor's browser still knows the rule exists, the
  same limitation Memberstack itself documents. Use `data-ms-protected`
  content blocks for anything that actually needs to stay hidden — those
  are fetched from the server only after checking the member's plan, so the
  real content never reaches a browser that shouldn't see it.
- Passwords are hashed with `scrypt` (Node's built-in, industry-standard
  KDF), never stored in plain text.
- Login tokens are signed JWTs (`node:crypto` HMAC-SHA256), expire after 7
  days, and are validated on every request.
- Change `JWT_SECRET` to a long random value before going live — anyone
  who has it can forge member sessions.

## What's not built yet (roadmap)

- **Payments.** Right now plans are assigned manually from the admin
  dashboard. Stripe (or, for Bangladesh, SSLCommerz/bKash) integration to
  auto-upgrade a member's plan on payment is the natural next step.
- **Email.** No verification or password-reset emails yet — add a
  transactional email provider (Resend, SES) when you need this.
- **CSV import from Webflow User Accounts**, so existing members migrate
  cleanly (Webflow lets you export their data as CSV — see Webflow's
  [User Accounts sunset guide](https://help.webflow.com/hc/en-us/articles/36046006227731-User-Accounts-sunset)).
- **Social login** (Google, etc.) — not started.

## Testing that's already been done

Every endpoint (signup, login, plan gating, content blocks, the admin
dashboard, the embeddable SDK) was exercised end-to-end in a real headless
browser against the demo page during development, including: wrong
password rejected, forged tokens rejected, rate limiting on auth routes,
free-vs-pro content gating, and session persistence across page reloads.
