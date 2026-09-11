// Screenshots the dashboard over the DevTools protocol. A plain `--screenshot` run never
// finishes here: the page holds an SSE connection open, so Chrome's virtual time budget
// waits forever for the network to go idle.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib/env.js';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browser = CANDIDATES.find((path) => existsSync(path));
if (!browser) {
  console.error('  no Chrome or Edge found');
  process.exit(1);
}

const url = process.argv[2] ?? 'http://localhost:8787';
const out = process.argv[3] ?? join(root, 'docs', 'screenshots', 'dashboard.png');
const port = 9222 + Math.floor(Math.random() * 500);

const chrome = spawn(browser, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1600,1400',
  '--force-device-scale-factor=2',
  '--user-data-dir=' + join(process.env.TEMP ?? '/tmp', `shoot-${port}`),
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (res?.ok) {
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    }
    await sleep(250);
  }
  throw new Error('chrome never came up');
}

const ws = new WebSocket(await endpoint());
await new Promise((resolve) => ws.addEventListener('open', resolve));

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Page.navigate', { url });
await sleep(3500);

const metrics = await send('Page.getLayoutMetrics');
const height = Math.ceil(metrics.cssContentSize.height);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height, deviceScaleFactor: 2, mobile: false,
});
await sleep(600);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });

mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`  ${out}  (1600x${height} @2x)`);

ws.close();
chrome.kill();
process.exit(0);
