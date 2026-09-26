// plans.js — single source of truth for what each plan allows.
//
// Phase 4 (limit enforcement) and the dashboard's usage display both read
// from here, so adding a paid tier later is just adding an entry below —
// no changes needed in the routes that enforce or display limits.

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    maxSites: 1,
    maxMembersPerSite: 100,
  },
};

const DEFAULT_PLAN = 'free';

function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

module.exports = { PLANS, DEFAULT_PLAN, getPlan };
