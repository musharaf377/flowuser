// billing.js — SSLCommerz checkout for upgrading an owner's plan.
//
// SSLCommerz's basic checkout API is a one-time charge, not native
// auto-recurring billing, so a successful payment grants PLAN_DURATION_MS
// (30 days) of access — the owner pays again to renew. See plans.js.
//
// Needs SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD env vars (get a
// free sandbox pair at https://developer.sslcommerz.com/registration/).
// SSLCOMMERZ_IS_LIVE=true switches from the sandbox to the live gateway.

const { Router, httpError } = require('../router');
const db = require('../db');
const auth = require('../auth');
const { requireOwnerAuth } = require('../middleware');
const { getPlan, PAID_PLANS, PLAN_DURATION_MS } = require('../plans');

const router = new Router();

function sslcommerzBaseUrl() {
  return process.env.SSLCOMMERZ_IS_LIVE === 'true'
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';
}

function sslcommerzCreds() {
  const store_id = process.env.SSLCOMMERZ_STORE_ID;
  const store_passwd = process.env.SSLCOMMERZ_STORE_PASSWORD;
  if (!store_id || !store_passwd) {
    throw httpError(503, 'Billing is not configured yet. Contact the site administrator.');
  }
  return { store_id, store_passwd };
}

// Render (and most PaaS) terminate TLS upstream and forward over plain
// HTTP, so req's own scheme isn't reliable — trust X-Forwarded-Proto.
function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

router.post('/api/billing/checkout', requireOwnerAuth, async (req, res) => {
  const { plan: planId } = req.body;
  if (!PAID_PLANS.includes(planId)) throw httpError(400, 'Unknown plan');
  const plan = getPlan(planId);

  const owner = await db.get('SELECT id, email FROM owners WHERE id = ?', [req.owner.id]);
  const { store_id, store_passwd } = sslcommerzCreds();
  const origin = originOf(req);
  const tranId = auth.randomId('txn_');

  await db.run(
    'INSERT INTO payments (id, owner_id, plan, amount, currency, tran_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [auth.randomId('pay_'), owner.id, planId, plan.priceBDT, 'BDT', tranId, 'pending', Date.now(), Date.now()]
  );

  const params = new URLSearchParams({
    store_id,
    store_passwd,
    total_amount: String(plan.priceBDT),
    currency: 'BDT',
    tran_id: tranId,
    success_url: `${origin}/api/billing/success`,
    fail_url: `${origin}/api/billing/fail`,
    cancel_url: `${origin}/api/billing/cancel`,
    ipn_url: `${origin}/api/billing/ipn`,
    shipping_method: 'NO',
    product_name: `FlowMember ${plan.name} plan`,
    product_category: 'Service',
    product_profile: 'general',
    cus_name: owner.email,
    cus_email: owner.email,
    cus_add1: 'N/A',
    cus_city: 'N/A',
    cus_country: 'Bangladesh',
    cus_phone: 'N/A',
  });

  let data;
  try {
    const sslRes = await fetch(`${sslcommerzBaseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    data = await sslRes.json();
  } catch (e) {
    throw httpError(502, 'Could not reach the payment gateway. Try again in a moment.');
  }

  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw httpError(502, data.failedreason || 'Could not start checkout with the payment gateway');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ redirectUrl: data.GatewayPageURL }));
});

// The only path that actually grants a plan. Re-verifies the transaction
// server-to-server via SSLCommerz's Validation API using val_id — never
// trusts a client-supplied "it worked" flag, since success_url/fail_url
// (below) can be visited directly by anyone without ever paying.
async function validateAndApply(tranId, valId) {
  const payment = await db.get('SELECT * FROM payments WHERE tran_id = ?', [tranId]);
  if (!payment) return false;
  if (payment.status === 'valid') return true; // already processed — idempotent

  const { store_id, store_passwd } = sslcommerzCreds();
  const params = new URLSearchParams({ val_id: valId, store_id, store_passwd, format: 'json' });
  const valRes = await fetch(`${sslcommerzBaseUrl()}/validator/api/validationserverAPI.php?${params.toString()}`);
  const data = await valRes.json();

  const isValid =
    (data.status === 'VALID' || data.status === 'VALIDATED') &&
    Number(data.amount) === payment.amount &&
    data.currency === payment.currency;

  if (!isValid) {
    await db.run('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?', ['failed', Date.now(), payment.id]);
    return false;
  }

  await db.run('UPDATE payments SET status = ?, val_id = ?, updated_at = ? WHERE id = ?', [
    'valid',
    valId,
    Date.now(),
    payment.id,
  ]);
  await db.run('UPDATE owners SET plan = ?, plan_expires_at = ? WHERE id = ?', [
    payment.plan,
    Date.now() + PLAN_DURATION_MS,
    payment.owner_id,
  ]);
  return true;
}

router.post('/api/billing/ipn', async (req, res) => {
  const { tran_id, val_id } = req.body;
  if (tran_id && val_id) {
    try {
      await validateAndApply(tran_id, val_id);
    } catch (e) {
      console.error('IPN validation error:', e);
    }
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

function redirectToAdmin(res, status) {
  res.writeHead(302, { Location: `/admin?billing=${status}` });
  res.end();
}

// SSLCommerz can be configured to hit these via GET or POST depending on
// the integration — handle both so neither mode 404s.
async function handleSuccess(req, res) {
  const { tran_id, val_id } = { ...req.query, ...req.body };
  if (tran_id && val_id) {
    try {
      await validateAndApply(tran_id, val_id);
    } catch (e) {
      console.error('Billing success validation error:', e);
    }
  }
  redirectToAdmin(res, 'success');
}

async function handleFail(req, res) {
  const { tran_id } = { ...req.query, ...req.body };
  if (tran_id) {
    await db.run('UPDATE payments SET status = ?, updated_at = ? WHERE tran_id = ? AND status = ?', [
      'failed',
      Date.now(),
      tran_id,
      'pending',
    ]);
  }
  redirectToAdmin(res, 'fail');
}

async function handleCancel(req, res) {
  const { tran_id } = { ...req.query, ...req.body };
  if (tran_id) {
    await db.run('UPDATE payments SET status = ?, updated_at = ? WHERE tran_id = ? AND status = ?', [
      'cancelled',
      Date.now(),
      tran_id,
      'pending',
    ]);
  }
  redirectToAdmin(res, 'cancel');
}

router.post('/api/billing/success', handleSuccess);
router.get('/api/billing/success', handleSuccess);
router.post('/api/billing/fail', handleFail);
router.get('/api/billing/fail', handleFail);
router.post('/api/billing/cancel', handleCancel);
router.get('/api/billing/cancel', handleCancel);

module.exports = router;
