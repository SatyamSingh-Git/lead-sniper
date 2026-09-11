const cfg = $('Prepare Poll').first().json;
const res = $input.first().json;
const state = $getWorkflowStaticData('global');

const remaining = Number(res.headers?.['x-ratelimit-remaining'] ?? -1);
const reset = Number(res.headers?.['x-ratelimit-reset'] ?? 0);

const halt = (reason, extra = {}) => [
  { json: { ...cfg, halt: true, reason, remaining, reset, scanned: 0, newCount: 0, ...extra } },
];

// Revalidation matched, so nothing has happened in this repo since the last poll and the
// request cost no quota at all.
if (res.statusCode === 304) {
  state.notModified += 1;
  state.savedRequests += 1;
  return halt('not_modified');
}

if (res.headers?.etag) state.etags[cfg.eventsUrl] = res.headers.etag;

// GitHub states how often this feed may be polled. Honour it rather than guessing.
const pollInterval = Number(res.headers?.['x-poll-interval'] ?? 0);

// Below the reserve we stop rather than race a concurrent job to zero. Ending the run
// cleanly instead of throwing means the next scheduled poll just picks up where we left off,
// with no failed execution to clear by hand.
if (remaining >= 0 && remaining < cfg.rateLimitReserve) {
  return halt('rate_limit_reserve', { pollInterval });
}

const events = Array.isArray(res.body) ? res.body : [];

// A star is a WatchEvent. The feed also carries pushes, forks, issues and PRs, which is why
// one page of 100 events yields far fewer than 100 stargazers.
const stars = events.filter((event) => event.type === 'WatchEvent');
const seen = new Set(state.seenLogins);

// created_at is a UTC ISO-8601 string, so lexical comparison is chronological. The feed is
// newest-first; we process oldest-first so the cursor advances monotonically.
const fresh = stars
  .filter((event) => event.created_at > cfg.lastStarredAt && !seen.has(event.actor.login))
  .sort((a, b) => a.created_at.localeCompare(b.created_at));

if (fresh.length === 0) return halt('no_new_stars', { scanned: stars.length, pollInterval });

// One viral hour should not drain the whole quota. The cursor only advances over what we
// actually process, so anything past the cap is picked up by the next poll rather than lost.
// A cold start (first activation, or any manual run) uses a tighter cap so it produces a
// readable handful of alerts rather than a wall of them.
const cap = cfg.coldStart ? cfg.coldStartMaxLeads : cfg.maxEnrichPerRun;
const budgeted = fresh.slice(0, cap);

return budgeted.map((event) => ({
  json: {
    ...cfg,
    halt: false,
    login: event.actor.login,
    avatarUrl: event.actor.avatar_url,
    starredAt: event.created_at,
    userUrl: `${cfg.apiBase}/users/${event.actor.login}`,
    scanned: stars.length,
    newCount: fresh.length,
    deferred: fresh.length - budgeted.length,
    pollInterval,
    remaining,
    reset,
  },
}));
