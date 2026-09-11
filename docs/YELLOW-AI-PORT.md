# Porting Lead Sniper to Yellow.ai

The assignment allowed either n8n or Yellow.ai. I built on n8n because the submission asks for a
workflow JSON file and n8n produces a genuinely portable one. This document is the answer to
*"could you build this on our stack?"* — written as a design, not an opinion.

## Node-by-node mapping

| Lead Sniper (n8n) | Yellow.ai Studio equivalent | Notes |
|---|---|---|
| Schedule Trigger (5 min) | Scheduled / cron trigger on an automation flow | Direct equivalent |
| Manual Trigger | Manual "Test flow" run | Direct equivalent |
| Config (Set node) | Flow variables / environment config | Direct equivalent |
| Probe + Fetch Stargazers (HTTP) | **API node** | Needs custom request headers — `Accept`, `If-None-Match`. The whole rate-limit strategy depends on being able to set and read arbitrary headers, so this is the node to validate first. |
| Stargazers Changed? (IF) | Condition node | Branch on HTTP status `304` |
| Prepare / Resolve / Select (Code) | **Function / script node** | JS logic ports as-is |
| Enrich Profile (HTTP, batched) | API node inside a **loop** node | See "What has to change" below |
| Score And Filter (Code) | Function node + Condition node | Direct equivalent |
| Build Prompt + OpenRouter (HTTP) | **GenAI / LLM node**, or an API node | Either works; an API node keeps the prompt-injection hardening explicit and portable |
| Parse Pitch (Code) | Function node | Direct equivalent |
| Discord embed + send (HTTP) | **Integration node** (Slack native) or API node for Discord | Slack is first-class; Discord goes through a generic API node |

## What has to change

**1. Cursor state.** The single biggest difference. n8n gives every workflow a durable
`$getWorkflowStaticData('global')` store that survives between executions — that is where the
dedupe cursor, the ETag map and the seen-login ring buffer live.

Yellow.ai flows are conversation-scoped by default, so a scheduled automation needs somewhere
external to keep that state. Options, in the order I'd try them:

- A bot-level **data table / custom entity** keyed by repo, holding `lastStarredAt` and the ETag
  map. Cleanest, and queryable for debugging.
- Global bot variables, if they persist across scheduled runs.
- An external key-value store called from the API node, if neither of the above is durable.

Without persistent state the ETag optimisation disappears entirely, and with it the "most polls
are free" property. This is the part of the port I would prototype before committing.

**2. Serialized fan-out.** n8n's HTTP node has a `batching` option that walks items one at a
time with an interval — that's what keeps us under GitHub's *secondary* (concurrency) rate
limits. In Yellow.ai this becomes an explicit loop node with a delay step inside it, iterating
the stargazer array rather than mapping over it.

**3. Retries and backoff.** n8n's `retryOnFail` / `waitBetweenTries` are node-level settings. If
the API node has no equivalent, the retry loop becomes explicit: a condition on the status code,
a delay, and an attempt counter in a flow variable — with `Retry-After` honoured where present.

**4. Item semantics.** n8n passes an *array of items* between nodes and runs each node once per
item. Yellow.ai passes a single context object. So the "one item per stargazer" model becomes an
explicit array in a variable plus a loop, and the `$('Node').all()` lookups in nodes 04, 06 and
08 become array indexing inside that loop.

## What ports unchanged

- All the API mechanics: `star+json`, `Link: rel="last"`, `If-None-Match`, reading
  `x-ratelimit-remaining`. These are properties of GitHub, not of the runtime.
- The scoring function — plain JS, drops straight into a function node.
- The prompt, the injection hardening, and the template fallback.
- The dashboard. It reads HTTP POSTs, so any platform that can make an outbound call can feed it.

## Honest assessment

The logic ports cleanly; roughly 80% of it is platform-agnostic JavaScript. The risk concentrates
in **one place: durable cross-run state**. Everything that makes this efficient rather than merely
working — conditional requests, the dedupe cursor, the budget breaker — depends on reading and
writing a small amount of data between scheduled executions.

If Yellow.ai gives a scheduled automation a durable store, this is a half-day port. If it does
not, the honest version is a polling flow that re-reads the newest page every time and dedupes
against a data table — still correct, but it gives up the free-304 property and costs about 12
requests an hour instead of near zero.
