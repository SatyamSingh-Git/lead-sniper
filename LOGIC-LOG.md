# Logic Log — handling GitHub's API rate limits

Submission requirement #3. Everything below is implemented in
[`workflow/nodes/`](workflow/nodes/) and verified by `npm test`.

---

## The short answer

I did not use a delay node as the rate-limit strategy. A delay only slows the rate you spend
quota; it does not reduce what you spend. The strategy has five layers, and the first one is the
one that matters most:

| Layer | Mechanism | Effect |
|---|---|---|
| 1 | `If-None-Match` conditional requests | Most polls cost **zero** quota |
| 2 | Authenticated PAT | 60 → 5,000 requests/hour, and the endpoint works at all |
| 3 | `per_page=100`, `Link: rel="last"`, per-run enrichment cap | Fewer requests per poll |
| 4 | Serialized fan-out via `batchInterval` | Avoids *secondary* limits |
| 5 | Budget circuit breaker on `x-ratelimit-remaining` | Fails safe, self-heals |

---

## Layer 1 — the requests we never pay for

The stargazer listing is polled every 5 minutes but changes far less often than that. So each
poll sends the ETag from the previous response:

```
GET /repos/{owner}/{repo}/stargazers?per_page=1
If-None-Match: W/"a1d7fd156fa76bb1"
```

If nothing changed GitHub replies `304 Not Modified` — and **a 304 does not decrement
`x-ratelimit-remaining`.** Revalidation is free. On a repo that gets a star every few minutes,
the majority of polls cost nothing at all, and the ones that do cost something are exactly the
ones that had work to do.

Two implementation details that are easy to get wrong:

- **ETags are cached per URL, not per repo.** The `per_page=1` probe and the `per_page=100&page=N`
  fetch are different resources with non-interchangeable validators. They are stored in a map
  keyed by full URL in `$getWorkflowStaticData('global')`.
- **The HTTP node needs `neverError: true`.** Otherwise n8n treats 304 as a failure and throws
  before our own branching logic can act on it.

The dashboard shows the running count of requests saved this way, because it is otherwise
invisible: a screenshot of a Discord message cannot show you the polls that cost nothing.

## Layer 2 — authenticate, which is not optional

Unauthenticated requests are limited to **60/hour per IP**; a PAT raises that to **5,000/hour**.
That alone is an 83× increase for one header.

More importantly, while testing this I found that `/stargazers` no longer serves anonymous
requests at all:

```
GET /repos/fastapi/fastapi/stargazers   (no token)   →  401 Requires authentication
GET /users/octocat                      (no token)   →  200 OK
```

*(verified 2026-09-09; the Accept header makes no difference — plain and `star+json` both 401.)*

So for this specific trigger a token is a hard dependency, not a quota optimisation. `npm run
preflight` checks for it explicitly and refuses to pass without one.

## Layer 3 — spend fewer requests per poll

**Page 1 is the wrong page.** `/stargazers` returns results **oldest-first**. A naive poller
fetches page 1 forever and re-reads whoever starred the repo in 2018, never seeing a new star.
The fix is to read the `Link` header's `rel="last"` cursor:

```
link: <...&per_page=1&page=88057>; rel="last"
```

With `per_page=1` that page number *is* the total star count, which makes the probe do double
duty — change detection and pagination maths in one cheap request. Two requests per poll total,
instead of walking 880 pages of history.

**`starred_at` requires an opt-in media type.** Without `Accept: application/vnd.github.star+json`
the response is a bare user array with no timestamp, and there is nothing to dedupe successive
polls against. With it, each entry becomes `{ starred_at, user }`.

**Other reductions:**
- `per_page=100` on the real fetch — 100× fewer requests per page of history.
- `MAX_ENRICH_PER_RUN` (default 20) caps enrichment calls per poll, so one viral hour cannot
  drain the budget. The cursor only advances over what was actually processed, so the remainder
  is picked up next poll rather than dropped.
- The qualification gate runs **before** the LLM call. The cheapest API call is the one you
  don't make, and that applies to token spend as much as to quota.

## Layer 4 — secondary rate limits are a different problem

GitHub enforces *secondary* limits on concurrency and burst, separately from the hourly quota.
You can sit at 4,900 of 5,000 remaining and still collect a `403` for firing 30 parallel
requests at once. n8n's default behaviour is exactly that: it fans every item out simultaneously.

So the enrichment node overrides it:

```json
"batching": { "batch": { "batchSize": 1, "batchInterval": 800 } }
```

One profile at a time, 800 ms apart. This is the one place a delay genuinely is the right tool —
not to conserve quota, but to stay under a concurrency ceiling.

On top of that, every GitHub node has `retryOnFail` with `waitBetweenTries: 2000`. Where a
response carries `Retry-After`, that value wins; otherwise retries back off exponentially with
jitter on `403`, `429` and `5xx`.

## Layer 5 — fail safe, and self-heal

Every response's `x-ratelimit-remaining` and `x-ratelimit-reset` are read and carried forward.
Below a **250-request reserve** the run stops:

```js
if (remaining >= 0 && remaining < cfg.rateLimitReserve) return halt('rate_limit_reserve');
```

Two deliberate choices here:

- **It ends cleanly rather than throwing.** An errored n8n execution is a thing a human has to go
  and clear. A clean end means the next scheduled poll simply picks up where this one stopped,
  with no intervention.
- **The cursor is not advanced.** Nothing is skipped; those stargazers are still waiting when
  quota returns.

The reserve exists because we are not necessarily the only consumer of the token. Leaving 250
requests unspent means a manual run, or another tool sharing the PAT, cannot push us to a hard
zero mid-flight.

---

## Where state lives

All of it is in `$getWorkflowStaticData('global')`, which n8n persists between executions:

| Key | Purpose |
|---|---|
| `lastStarredAt` | The dedupe cursor — high-water mark of processed stars |
| `etags` | ETag per URL, for conditional requests |
| `seenLogins` | Bounded ring buffer (500) against duplicate alerts on tied timestamps |
| `polls`, `notModified`, `savedRequests` | Counters the dashboard reads |

### The catch: manual executions never persist any of it

n8n only writes static data back for production runs. From its execution lifecycle hooks:

```js
const isManualMode = this.mode === 'manual';
if (!isManualMode && isWorkflowIdValid(this.workflowData.id) && newStaticData) {
    await workflowStaticDataService.saveStaticDataById(...)
}
```

So every **Test workflow** click cold-starts: empty cursor, empty ETag cache. Two consequences
worth being explicit about, because both are counter-intuitive:

1. **The 304 path cannot be demonstrated manually.** No stored ETag means no `If-None-Match`
   means a full `200` every time. The cheapest thing this pipeline does only starts working
   once the workflow is **Activated** and the schedule trigger drives it.
2. **Manual runs would re-alert the same people**, every click, because the cursor never advances.

The mitigation is the `coldStartMaxLeads` cap (default 3): a cold start — first activation *or*
any manual run — processes a readable handful instead of a wall of duplicates. It is deliberately
much tighter than the steady-state `maxEnrichPerRun` of 20.

The honest framing: this is a property of n8n, not a bug in the workflow, but a design that ignores
it looks broken in exactly the moment someone is watching.

### Two related decisions

- **Bootstrap.** On the very first run there is no cursor. Rather than replay 88,000 historical
  stargazers, the cursor seeds to *now minus 24 hours*.
- **Write last.** The cursor advances only after Discord delivery succeeds. If a run dies halfway
  the same stars are reprocessed next poll. For sales leads, a duplicate alert is a much cheaper
  failure than a silently dropped one — at-least-once beats at-most-once here.

---

## Cost of a poll, in practice

| Scenario | Requests spent |
|---|---|
| Nothing changed (the common case) | **0** — a single 304 |
| New stars, 6 of them, 3 qualifying | 2 listing + 6 enrichment = **8** |
| Worst case, enrichment cap hit | 2 + 20 = **22** |

At 5-minute polling that is 12 polls/hour. Even if *every* poll found new stars, the ceiling is
~264 requests/hour against a 5,000 budget — roughly 5% utilisation, with the reserve never
approached. In practice most polls cost nothing.

---

## What I would add next

- **Webhooks instead of polling.** GitHub's `watch` event fires on star, which removes the
  listing cost entirely. I stayed with polling because the assignment names it, and because a
  webhook needs a public endpoint that a reviewer cannot reproduce locally.
- **A shared quota ledger.** The reserve is a heuristic standing in for coordination between
  jobs sharing one token. A small counter in Redis would make it exact.
- **Conditional requests on enrichment too.** Profiles change rarely, so per-login ETags would
  make repeat sightings free. The dedupe ring buffer already prevents most repeat fetches, so
  this is a smaller win than it first appears.
