// Renders the workflow JSON as a PDF. The submission form accepts "PDF or document" and may
// reject a raw .json upload outright, so this wraps the same artifact in a format that is
// certain to be accepted, with the repo link and import instructions on the front page.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib/env.js';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('  no Chrome or Edge found');
  process.exit(1);
}

const workflowPath = join(root, 'workflow', 'lead-sniper.workflow.json');
const workflow = readFileSync(workflowPath, 'utf8');
const parsed = JSON.parse(workflow);
const outDir = join(root, 'submission');
const outPdf = join(outDir, 'lead-sniper-workflow.pdf');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const nodeRows = parsed.nodes
  .map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.type.replace('n8n-nodes-base.', ''))}</td></tr>`)
  .join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  @page { margin: 18mm 14mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  .sub { color: #555; margin: 0 0 18pt; }
  h2 { font-size: 12pt; margin: 20pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  td { border-bottom: 1px solid #eee; padding: 3pt 6pt; }
  td:last-child { color: #666; font-family: ui-monospace, Consolas, monospace; }
  a { color: #0969da; }
  ul { margin: 6pt 0; padding-left: 16pt; }
  li { margin: 3pt 0; }
  pre { font-family: ui-monospace, Consolas, monospace; font-size: 6.5pt; line-height: 1.35;
        white-space: pre-wrap; word-break: break-all; color: #222; }
  .note { background: #f6f8fa; border-left: 3px solid #0969da; padding: 8pt 10pt; font-size: 10pt; }
</style>
<h1>Lead Sniper — n8n Workflow</h1>
<p class="sub">Assignment 1 · GitHub high-value lead tracker · ${parsed.nodes.length} nodes</p>

<div class="note">
  <b>The importable JSON file is in the repository:</b><br>
  <a href="https://github.com/SatyamSingh-Git/lead-sniper">github.com/SatyamSingh-Git/lead-sniper</a>
  → <code>workflow/lead-sniper.workflow.json</code><br><br>
  This PDF contains the identical file inline, because the upload field accepts documents rather
  than raw JSON. The full source text begins overleaf.
</div>

<h2>To import</h2>
<ul>
  <li>n8n → Workflows → Import from File → <code>lead-sniper.workflow.json</code></li>
  <li>Create two <b>Header Auth</b> credentials, both with header name <code>Authorization</code>:
      a GitHub token as <code>Bearer ghp_…</code>, and an OpenRouter key as <code>Bearer sk-or-v1-…</code></li>
  <li>Attach the GitHub credential to <i>Fetch Repo Events</i> and <i>Enrich Profile</i>;
      the OpenRouter credential to <i>Generate Pitch</i></li>
  <li>Set <code>discordWebhookUrl</code> in the <b>Config</b> node (it ships as a placeholder — no
      secret is committed)</li>
  <li>Activate the workflow. Manual runs do not persist n8n static data, so the ETag cache and
      dedupe cursor only work in production mode</li>
</ul>

<h2>Nodes</h2>
<table>${nodeRows}</table>

<h2>Workflow JSON</h2>
<pre>${esc(workflow)}</pre>`;

const htmlPath = join(process.env.TEMP ?? '/tmp', 'lead-sniper-submission.html');
writeFileSync(htmlPath, html);

const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(browser, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--user-data-dir=' + join(process.env.TEMP ?? '/tmp', `pdf-${port}`),
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (res?.ok) {
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    }
    await sleep(250);
  }
  throw new Error('chrome never came up');
}

const ws = new WebSocket(await endpoint());
await new Promise((r) => ws.addEventListener('open', r));

let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = id++;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await send('Page.navigate', { url: `file:///${htmlPath.replace(/\\/g, '/')}` });
await sleep(1800);

const pdf = await send('Page.printToPDF', {
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="font:8pt sans-serif;color:#888;width:100%;text-align:center;">' +
    'Lead Sniper · github.com/SatyamSingh-Git/lead-sniper · ' +
    '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});

mkdirSync(outDir, { recursive: true });
writeFileSync(outPdf, Buffer.from(pdf.data, 'base64'));
console.log(`  ${outPdf}`);

ws.close();
chrome.kill();
process.exit(0);
