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

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    maxSites: 1,
    maxMembersPerSite: 100,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    maxSites: 5,
    maxMembersPerSite: 1000,
  },
  business: {
    id: 'business',
    name: 'Business',
    maxSites: UNLIMITED,
    maxMembersPerSite: UNLIMITED,
  },
};

const DEFAULT_PLAN = 'free';

function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

// Super admins bypass plan limits entirely, regardless of their own
// `plan` column — they get the same unlimited shape as the Business plan.
function getEffectivePlan(owner) {
  return owner.is_super_admin ? PLANS.business : getPlan(owner.plan);
}

module.exports = { PLANS, DEFAULT_PLAN, UNLIMITED, getPlan, getEffectivePlan };
