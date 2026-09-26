const { Router } = require('../router');
const { PLANS, DEFAULT_PLAN } = require('../plans');

const router = new Router();

// public — used by the landing page pricing section and the post-signup
// "you're on the Free plan" confirmation screen, so both read the real
// limits instead of hardcoding copies that can drift from plans.js.
router.get('/api/plans', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ plans: PLANS, defaultPlan: DEFAULT_PLAN }));
});

module.exports = router;
