// A local stand-in for the GitHub API, so the whole n8n workflow can be demonstrated with
// no token, no network and no quota. It implements the three behaviours the pipeline
// actually depends on: star+json timestamps, Link rel="last" pagination, and ETag
// revalidation returning a free 304.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 8788);
const LIMIT = 5000;
const NEW_STAR_EVERY_MS = 20000;

let used = 0;
const resetAt = Math.floor(Date.now() / 1000) + 3600;

const PEOPLE = [
  { login: 'sindresorhus', name: 'Sindre Sorhus', company: '@sindresorhus', location: 'Norway',
    email: null, blog: 'https://sindresorhus.com', twitter_username: 'sindresorhus',
    bio: 'Full-Time Open-Sourcerer. Focused on developer tooling and automation.',
    followers: 62400, public_repos: 1180, public_gists: 90, created_at: '2010-06-05T00:00:00Z' },
  { login: 'anya-cx', name: 'Anya Kowalski', company: 'Helio Support Cloud', location: 'Berlin',
    email: 'anya@helio.io', blog: 'https://anya.dev', twitter_username: null,
    bio: 'Building conversational AI and LLM agents for customer support teams. Ex-NLP research.',
    followers: 840, public_repos: 74, public_gists: 11, created_at: '2014-03-19T00:00:00Z' },
  { login: 'infra-mika', name: 'Mika Toivonen', company: 'Northbound Data', location: 'Helsinki',
    email: null, blog: '', twitter_username: null,
    bio: 'Platform engineer. Kubernetes, event pipelines, too much YAML.',
    followers: 210, public_repos: 63, public_gists: 4, created_at: '2013-08-01T00:00:00Z' },
  { login: 'quietbuilder', name: 'Marco Ferreira', company: null, location: 'Lisbon',
    email: null, blog: '', twitter_username: null, bio: 'I ship small things.',
    followers: 118, public_repos: 9, public_gists: 0, created_at: '2019-11-02T00:00:00Z' },
  { login: 'driveby', name: null, company: null, location: null, email: null, blog: null,
    twitter_username: null, bio: null, followers: 4, public_repos: 2, public_gists: 0,
    created_at: '2025-02-14T00:00:00Z' },
  { login: 'newacct2026', name: null, company: null, location: null, email: null, blog: null,
    twitter_username: null, bio: null, followers: 0, public_repos: 1, public_gists: 0,
    created_at: '2026-06-01T00:00:00Z' },
];

const profileOf = (person) => ({
  ...person,
  id: [...person.login].reduce((n, ch) => n + ch.charCodeAt(0), 0),
  avatar_url: `https://avatars.githubusercontent.com/u/${(person.login.length * 9161) % 90000}?v=4`,
  html_url: `https://github.com/${person.login}`,
  updated_at: new Date(Date.now() - 3600e3).toISOString(),
});

// A backlog of historical stars, plus one new arrival every 20s so consecutive polls show
// a 304 first and then real movement.
const BACKLOG = 87990;
const started = Date.now();
function stargazers() {
  const arrived = Math.floor((Date.now() - started) / NEW_STAR_EVERY_MS);
  return PEOPLE.slice(0, Math.min(arrived, PEOPLE.length)).map((person, i) => ({
    starred_at: new Date(started + (i + 1) * NEW_STAR_EVERY_MS).toISOString(),
    user: profileOf(person),
  }));
}

const etagOf = (payload) => `W/"${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;

function rateHeaders(spent) {
  used += spent;
  return {
    'x-ratelimit-limit': String(LIMIT),
    'x-ratelimit-remaining': String(Math.max(0, LIMIT - used)),
    'x-ratelimit-used': String(used),
    'x-ratelimit-reset': String(resetAt),
    'x-ratelimit-resource': 'core',
  };
}

function body(req, handle) {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => handle(raw));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...extra });
    res.end(JSON.stringify(body));
  };

  const stars = stargazers();
  const total = BACKLOG + stars.length;

  if (/^\/repos\/[^/]+\/[^/]+\/stargazers$/.test(url.pathname)) {
    const perPage = Number(url.searchParams.get('per_page') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const payload = perPage === 1 ? [] : stars;
    const etag = etagOf({ perPage, page, count: stars.length });

    // A revalidated request that has not changed costs the caller nothing at all. This is
    // the single biggest rate-limit lever the real API offers, so the mock honours it.
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, ...rateHeaders(0) });
      return res.end();
    }

    const link = `<${url.origin}${url.pathname}?per_page=${perPage}&page=${lastPage}>; rel="last"`;
    return json(200, payload, { etag, link, ...rateHeaders(1) });
  }

  // The repository events feed, which is what the workflow actually polls. Stars arrive as
  // WatchEvents mixed in with pushes and forks, exactly as the real feed delivers them.
  if (/^\/repos\/[^/]+\/[^/]+\/events$/.test(url.pathname)) {
    const feed = [
      ...stars.map((s) => ({
        type: 'WatchEvent',
        created_at: s.starred_at,
        actor: { login: s.user.login, avatar_url: s.user.avatar_url },
      })),
      { type: 'PushEvent', created_at: new Date().toISOString(), actor: { login: 'a-committer' } },
      { type: 'ForkEvent', created_at: new Date().toISOString(), actor: { login: 'a-forker' } },
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    const etag = etagOf({ feed: feed.length });
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, ...rateHeaders(0) });
      return res.end();
    }
    return json(200, feed, { etag, 'x-poll-interval': '60', ...rateHeaders(1) });
  }

  const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);
  if (userMatch) {
    const person = PEOPLE.find((p) => p.login === userMatch[1]);
    if (!person) return json(404, { message: 'Not Found' }, rateHeaders(1));
    return json(200, profileOf(person), rateHeaders(1));
  }

  if (url.pathname === '/rate_limit') {
    return json(200, { resources: { core: { limit: LIMIT, remaining: LIMIT - used, reset: resetAt, used } } });
  }

  // --- OpenRouter stand-in -------------------------------------------------------------
  if (url.pathname === '/api/v1/chat/completions' && req.method === 'POST') {
    return body(req, (raw) => {
      const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n');
      const field = (key) => (prompt.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1] ?? '').trim();

      // Built from the prompt we were actually sent, so a broken prompt shows up as a
      // broken pitch rather than passing silently.
      const name = field('name');
      const company = field('company');
      const bio = field('bio');
      const pitch = company && company !== '(none)'
        ? `${name} works at ${company} and their profile points straight at our space — worth a direct reach-out.`
        : `${name} has real reach on GitHub and ${bio !== '(none)' ? 'a bio that lines up with our product' : 'an active build history'} — worth a look.`;

      return json(200, {
        id: 'gen-mock', model: 'mock/offline-instruct',
        choices: [{ message: { role: 'assistant', content: JSON.stringify({ pitch, angle: 'offline mock', confidence: 0.77 }) } }],
        usage: { total_tokens: 180 + prompt.length % 120 },
      });
    });
  }

  // --- Discord webhook stand-in --------------------------------------------------------
  if (/^\/api\/webhooks\//.test(url.pathname) && req.method === 'POST') {
    return body(req, (raw) => {
      const embed = JSON.parse(raw).embeds?.[0];
      console.log(`  discord  <-  ${embed?.author?.name ?? '?'}  ${embed?.title ?? ''}`);
      res.writeHead(204);
      res.end();
    });
  }

  json(404, { message: 'Not Found' });
}).listen(PORT, () => {
  console.log(`\n  mock github api  ·  http://localhost:${PORT}`);
  console.log(`  a new stargazer arrives every ${NEW_STAR_EVERY_MS / 1000}s (${PEOPLE.length} in the cast)`);
  console.log(`  point the workflow's Config.apiBase at it, then run the flow\n`);
});
