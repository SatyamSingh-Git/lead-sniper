import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const storePath = join(here, 'data', 'events.json');

const PORT = Number(process.env.PORT ?? 8787);
const MAX_EVENTS = 500;

const events = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : [];
const clients = new Set();

let flushTimer = null;
function persist() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(events.slice(-MAX_EVENTS)));
  }, 400);
}

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(frame);
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

async function serveStatic(res, urlPath) {
  const file = join(publicDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(publicDir)) return send(res, 403, 'text/plain', 'forbidden');

  const body = await readFile(file).catch(() => null);
  if (!body) return send(res, 404, 'text/plain', 'not found');
  send(res, 200, MIME[extname(file)] ?? 'application/octet-stream', body);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
  });
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    });
    return res.end();
  }

  if (pathname === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, events: events.length }));

  if (pathname === '/event' && req.method === 'POST') {
    const raw = await readBody(req);
    // n8n is a fire-and-forget producer here: it must get a fast 200 whatever it sent us,
    // so a malformed payload is recorded rather than rejected.
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { type: 'malformed', raw: raw.slice(0, 400) };
    }
    const event = { ...payload, ts: Date.now(), seq: (events.at(-1)?.seq ?? 0) + 1 };
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    broadcast(event);
    persist();
    return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
  }

  if (pathname === '/reset' && req.method === 'POST') {
    events.length = 0;
    broadcast({ type: 'reset', ts: Date.now() });
    persist();
    return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
  }

  if (pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'snapshot', events })}\n\n`);
    clients.add(res);

    const beat = setInterval(() => res.write(': keepalive\n\n'), 25000);
    req.on('close', () => {
      clearInterval(beat);
      clients.delete(res);
    });
    return;
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`\n  LEAD SNIPER · mission control`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ${events.length} event(s) restored\n`);
});
