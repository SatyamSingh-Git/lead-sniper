# Demo recording — shot list

Target length **2:30–3:00**. The goal is not to narrate the workflow node by node; it is to show
three things a reviewer cannot get from the JSON: that it runs, that the rate-limit work is real,
and that the AI output is grounded.

## Before you hit record

```bash
npm run preflight        # must be all green
npm run dashboard        # :8787
npx n8n                  # :5678
```

- **Record into a clean Discord channel.** Shot 1 opens on an empty channel, and any earlier
  test run will have left alerts in it. Make a fresh `#leads-demo` channel, point
  `DISCORD_WEBHOOK_URL` at its webhook, `npm run build`, and re-import. Keep the old channel —
  its real delivered alerts are what you screenshot for submission requirement #2.
- Discord channel open in a third window, scrolled to the bottom.
- **Drop the Schedule Trigger to 1 minute for the recording.** The `304 · 0 quota` line is the
  best moment in this demo, and it only appears on a *second* poll in production mode — n8n never
  persists static data for manual runs, so "Test workflow" can never produce it. At the default
  5 minutes you would wait ten minutes on camera. Set it to 1 minute, activate, capture two ticks,
  then set it back to 5 before exporting the final JSON.
- **Use a fresh workflow each take.** The cursor persists, so a second run on the same workflow
  correctly reports "no new stars" and nothing appears. Re-import to reset it.
- **`npm run scrub`** — confirm the artifact you're about to show is clean.
- Zoom the n8n canvas so all 24 nodes fit; the shape of the flow is part of the point.
- **Live or mock?** Live on `fastapi/fastapi` is more convincing but thin — roughly one lead per
  twenty-five stargazers, because most people starring a famous repo are learners. The mock gives
  a denser funnel with HOT/WARM/COLD tiers. Record live; if you want both, show the mock second
  and say plainly that it is a mock. Never let a mock read as real traffic.
- To run on the mock: `npm run mock`, then point `Config.apiBase` at `http://localhost:8788`,
  `llmUrl` at `http://localhost:8788/api/v1/chat/completions` and `discordWebhookUrl` at
  `http://localhost:8788/api/webhooks/1/demo`.

## Shots

**1 · The problem (0:00–0:15)**
Discord channel, empty. *"Someone with 60,000 followers just starred our repo. Nobody noticed.
That's the problem."*

**2 · The flow (0:15–0:45)**
n8n canvas, whole workflow visible. Trace the path with the cursor while talking:
*"Poll the repo's event feed, enrich each new stargazer, filter, write a pitch, ship it to
Discord."*
Then hover the **Fetch Repo Events** node and open its headers:
*"GitHub withdrew the stargazers endpoint for repos you don't own — 404 at every size, with a
fully-scoped token. Stars still show up in the events feed as WatchEvents, and that feed is
open. It's also cheaper: newest-first, so there's no pagination to walk."*
Then point at `If-None-Match`:
*"And this is why most polls cost zero API quota."*

**3 · Run it (0:45–1:30)**
Hit **Run Once (Demo)**. Cut to the dashboard as it fills:
- funnel animating — stargazers scanned, new ones enriched, a handful qualified
- the quota gauge, and the `304 · 0 quota` lines in the event stream
- a lead card landing with its score ring

*"Sixty-nine stargazers, one passed the gate. The other twenty-four cost one profile lookup each
and nothing more — the filter runs before the LLM, so we never spend tokens on someone we were
never going to contact."*

**3b · The free poll (1:30–1:50)**
Stay on the dashboard through the second tick. The event stream prints
`GET /events 304 · 0 quota` and **the budget number does not move.**
*"That's the whole rate-limit strategy in one line. Conditional request, nothing changed, GitHub
returns 304 — and a 304 doesn't count against the limit at all. Most polls are free."*

**4 · The pitch is grounded (1:50–2:15)**
Zoom one HOT card. Read the bio, then read the pitch.
*"It didn't invent an employer or a job title. Everything in that sentence is in the profile —
and the bio is untrusted text, so it's wrapped and the model is told to treat it as data."*

**5 · Discord (2:15–2:35)**
Switch to Discord. The embeds are already there. Show the tier colour, the score, the pitch
field, the footer showing which gate condition fired.

**6 · Close (2:35–2:55)**
Back to the dashboard, on the quota gauge.
*"Two polls, one of them completely free — the second cost zero quota because nothing had
changed. Budget still 4,873 of 5,000. It keeps running every five minutes without anyone
touching it."*

## If something breaks on camera

Don't re-record — narrate it. A 403 that backs off and retries, or an LLM failure falling
through to the template pitch, is a **better** demo than a clean run: it shows the failure paths
are real. The event stream and the `fallback` tag on the card make both visible.

## Screenshots to capture separately

| File | Shot |
|---|---|
| `docs/screenshots/discord.png` | A delivered embed, HOT tier — submission requirement #2 |
| `docs/screenshots/dashboard.png` | Full dashboard mid-run (`npm run shoot` regenerates it) |
| `docs/screenshots/n8n-canvas.png` | The whole workflow on the n8n canvas |
| `docs/screenshots/preflight.png` | An all-green `npm run preflight` |
