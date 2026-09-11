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

- Discord channel open in a third window, scrolled to the bottom.
- **Activate the workflow before recording, and let it tick at least twice.** Manual runs never
  persist static data in n8n, so the `304 · 0 quota` line — the single best moment in this demo —
  only appears on the second *scheduled* poll. Filming manual runs throws that shot away.
- **`npm run scrub`** — confirm the artifact you're about to show is clean.
- Zoom the n8n canvas so all 26 nodes fit; the shape of the flow is part of the point.
- If the target repo is quiet, start `npm run mock` and point `Config.apiBase` at
  `http://localhost:8788`. A new stargazer arrives every 20 seconds, so the demo never depends on
  a stranger starring a repo on cue.

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

*"Three of six passed the gate. The other three cost us nothing past one profile lookup —
the filter runs before the LLM, so we never spend tokens on a lead we're not going to contact."*

**4 · The pitch is grounded (1:30–2:00)**
Zoom one HOT card. Read the bio, then read the pitch.
*"It didn't invent an employer or a job title. Everything in that sentence is in the profile —
and the bio is untrusted text, so it's wrapped and the model is told to treat it as data."*

**5 · Discord (2:00–2:20)**
Switch to Discord. The embeds are already there. Show the tier colour, the score, the pitch
field, the footer showing which gate condition fired.

**6 · Close (2:20–2:45)**
Back to the dashboard, on the quota gauge.
*"Twelve polls, nine of them free. Full budget still 4,900 of 5,000. It'll keep running every
five minutes without anyone touching it."*

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
