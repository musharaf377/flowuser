// plans.js — single source of truth for what each plan allows.
//
// Phase 4 (limit enforcement) and the dashboard's usage display both read
// from here, so adding a paid tier later is just adding an entry below —
// no changes needed in the routes that enforce or display limits.

// JSON.stringify(Infinity) serializes to `null`, which would silently break
// every `count >= plan.maxSites` check downstream (null coerces to 0 in a
// numeric comparison). Use a large finite sentinel instead so "unlimited"
// survives the API round-trip as an ordinary number.
const UNLIMITED = Number.MAX_SAFE_INTEGER;

// How long a paid plan lasts per payment — SSLCommerz's basic checkout API
// is a one-time charge, not native auto-recurring billing, so a purchase
// grants 30 days of access; the owner pays again to renew (see billing.js).
const PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    maxSites: 1,
    maxMembersPerSite: 100,
    priceBDT: 0,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    maxSites: 5,
    maxMembersPerSite: 1000,
    priceBDT: 999,
  },
  business: {
    id: 'business',
    name: 'Business',
    maxSites: UNLIMITED,
    maxMembersPerSite: UNLIMITED,
    priceBDT: 2999,
  },
};

const DEFAULT_PLAN = 'free';
const PAID_PLANS = ['pro', 'business'];

function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

// Super admins bypass plan limits entirely, regardless of their own
// `plan` column — they get the same unlimited shape as the Business plan.
// A paid plan past its plan_expires_at is treated as Free even if the DB
// row hasn't been lazily downgraded yet (owner.js does that on login/me) —
// belt and suspenders so limit checks are never fooled by a stale row.
function getEffectivePlan(owner) {
  if (owner.is_super_admin) return PLANS.business;
  if (PAID_PLANS.includes(owner.plan) && owner.plan_expires_at && owner.plan_expires_at < Date.now()) {
    return PLANS[DEFAULT_PLAN];
  }
  return getPlan(owner.plan);
}

module.exports = {
  PLANS,
  DEFAULT_PLAN,
  PAID_PLANS,
  PLAN_DURATION_MS,
  UNLIMITED,
  getPlan,
  getEffectivePlan,
};
