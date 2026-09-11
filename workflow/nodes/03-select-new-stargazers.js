const cfg = $('Resolve Last Page').first().json;
const res = $input.first().json;
const state = $getWorkflowStaticData('global');

const remaining = Number(res.headers?.['x-ratelimit-remaining'] ?? cfg.remaining);
const reset = Number(res.headers?.['x-ratelimit-reset'] ?? cfg.reset);

const halt = (reason, extra = {}) => [
  { json: { ...cfg, halt: true, reason, remaining, reset, scanned: 0, newCount: 0, ...extra } },
];

if (res.statusCode === 304) {
  state.notModified += 1;
  state.savedRequests += 1;
  return halt('not_modified');
}

if (res.headers?.etag) state.etags[cfg.pageUrl] = res.headers.etag;

// Below the reserve we stop rather than race a concurrent job to zero. Ending the run
// cleanly instead of throwing means the next scheduled poll just picks up where we left off,
// with no failed execution to clear by hand.
if (remaining >= 0 && remaining < cfg.rateLimitReserve) {
  return halt('rate_limit_reserve');
}

const stars = Array.isArray(res.body) ? res.body : [];
const seen = new Set(state.seenLogins);

// starred_at is a UTC ISO-8601 string, so lexical comparison is chronological.
const fresh = stars
  .filter((s) => s.starred_at > cfg.lastStarredAt && !seen.has(s.user.login))
  .sort((a, b) => a.starred_at.localeCompare(b.starred_at));

if (fresh.length === 0) return halt('no_new_stars', { scanned: stars.length });

// One viral hour should not drain the whole quota. The cursor only advances over what we
// actually process, so anything past the cap is picked up by the next poll rather than lost.
// A cold start (first activation, or any manual run) uses a tighter cap so it produces a
// readable handful of alerts rather than a wall of them.
const cap = cfg.coldStart ? cfg.coldStartMaxLeads : cfg.maxEnrichPerRun;
const budgeted = fresh.slice(0, cap);

return budgeted.map((s) => ({
  json: {
    ...cfg,
    halt: false,
    login: s.user.login,
    avatarUrl: s.user.avatar_url,
    starredAt: s.starred_at,
    userUrl: `${cfg.apiBase}/users/${s.user.login}`,
    scanned: stars.length,
    newCount: fresh.length,
    deferred: fresh.length - budgeted.length,
    remaining,
    reset,
  },
}));
