import { loadEnv } from './lib/env.js';

const env = loadEnv();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const results = [];

function record(name, ok, detail, hint) {
  results.push({ name, ok, detail, hint });
  const mark = ok === true ? c.green('  OK  ') : ok === 'warn' ? c.amber(' WARN ') : c.red(' FAIL ');
  console.log(`[${mark}] ${c.bold(name.padEnd(22))} ${detail}`);
  if (!ok && hint) console.log(`         ${c.dim(hint)}`);
}

function isPlaceholder(value) {
  return !value || /x{6,}|^0{6,}/i.test(value);
}

async function checkGithubQuota() {
  if (isPlaceholder(env.GITHUB_TOKEN)) {
    return record(
      'GitHub token',
      false,
      'missing or still the placeholder',
      'Unauthenticated is 60 req/hr and the demo will die. Create one at github.com/settings/tokens',
    );
  }

  // /rate_limit is the one endpoint that does not itself consume quota.
  const res = await fetch('https://api.github.com/rate_limit', {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'lead-sniper-preflight' },
  });

  if (res.status === 401) {
    return record('GitHub token', false, 'rejected (401)', 'Token is expired or mistyped.');
  }

  const { resources } = await res.json();
  const core = resources.core;
  const mins = Math.round((core.reset * 1000 - Date.now()) / 60000);
  const headroom = core.remaining / core.limit;

  record(
    'GitHub token',
    headroom > 0.1 ? true : 'warn',
    `${c.cyan(String(core.remaining))} / ${core.limit} requests left, resets in ${mins}m`,
    headroom > 0.1 ? null : 'Low quota. Wait for the reset before recording the demo.',
  );
}

async function checkRepoAndStarHeader() {
  const [owner, name] = env.GITHUB_REPO.split('/');
  if (!owner || !name) {
    return record('Target repo', false, `"${env.GITHUB_REPO}" is not owner/name`);
  }

  const headers = {
    // Without this Accept header the response is a bare user array with no starred_at,
    // and there is nothing to dedupe a poll against.
    Accept: 'application/vnd.github.star+json',
    'User-Agent': 'lead-sniper-preflight',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (!isPlaceholder(env.GITHUB_TOKEN)) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const url = `https://api.github.com/repos/${owner}/${name}/stargazers?per_page=1`;
  const res = await fetch(url, { headers });

  if (res.status === 404) {
    // GitHub answers 404 rather than 403 here so it never discloses what you cannot reach.
    // If the repo itself is readable, the repo is fine and the token's scopes are not:
    // /stargazers and /subscribers return user lists and are gated, while /forks and
    // /contributors on the same repo are not.
    const meta = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
    if (meta.ok) {
      return record(
        'Target repo',
        false,
        `${env.GITHUB_REPO} is readable, but its stargazer list is not (404)`,
        'The token needs a scope to read user lists. Regenerate a classic token with read:user (and public_repo if that alone is not enough).',
      );
    }
    return record('Target repo', false, `${env.GITHUB_REPO} not found`);
  }
  if (res.status === 401) {
    return record(
      'Target repo',
      false,
      'stargazers requires authentication (401)',
      'This endpoint is auth-gated — unlike /users, it returns 401 with no token at all.',
    );
  }
  if (res.status === 403 || res.status === 429) {
    const left = Number(res.headers.get('x-ratelimit-remaining') ?? -1);
    const retryAfter = res.headers.get('retry-after');

    // A 403 with quota still on the clock is a permissions problem wearing a rate limit's
    // status code. Reporting it as "rate limited" sends you off to wait for a reset that
    // will change nothing.
    if (left > 0 && !retryAfter) {
      const { message } = await res.json().catch(() => ({}));
      return record(
        'Target repo',
        false,
        `${message ?? 'forbidden'} (403, ${left} requests still available)`,
        'Fine-grained tokens reach only repos you own. Use a classic token with no scopes, or grant "Public Repositories (read-only)".',
      );
    }

    const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000;
    return record('Target repo', false, `rate limited (${res.status})`, `Resets ${new Date(reset).toLocaleTimeString()}.`);
  }
  if (!res.ok) {
    return record('Target repo', false, `unexpected status ${res.status}`);
  }
  if (res.redirected) {
    record('Repo redirect', 'warn', `${env.GITHUB_REPO} 301s to ${res.url.split('/').slice(-2, -1)[0]}`,
      'The repo was renamed or transferred. Use the canonical path to save a request per poll.');
  }

  const link = res.headers.get('link') ?? '';
  const last = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  const totalStars = last ? Number(last[1]) : 1;
  const body = await res.json();
  const hasTimestamp = Array.isArray(body) && body[0] && 'starred_at' in body[0];

  record(
    'Target repo',
    true,
    `${c.cyan(env.GITHUB_REPO)} — ${totalStars.toLocaleString()} stars, newest on page ${Math.ceil(totalStars / 100)}`,
  );
  record(
    'starred_at header',
    hasTimestamp,
    hasTimestamp ? `star+json accepted, cursor field present` : 'no starred_at in response',
    hasTimestamp ? null : 'Dedupe by timestamp will not work without it.',
  );

  const etag = res.headers.get('etag');
  if (etag) {
    const revalidated = await fetch(url, { headers: { ...headers, 'If-None-Match': etag } });
    const before = Number(res.headers.get('x-ratelimit-remaining'));
    const after = Number(revalidated.headers.get('x-ratelimit-remaining'));
    const free = revalidated.status === 304 && after >= before;
    record(
      'ETag revalidation',
      free ? true : 'warn',
      free
        ? `304 Not Modified cost ${c.cyan('0')} of quota (${before} then ${after})`
        : `got ${revalidated.status}, quota ${before} then ${after}`,
      free ? null : 'Conditional requests are the main rate-limit lever; expected a free 304.',
    );
  }
}

async function checkOpenRouter() {
  if (isPlaceholder(env.OPENROUTER_API_KEY)) {
    return record('OpenRouter key', false, 'missing or still the placeholder', 'Get one at openrouter.ai/keys');
  }

  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });

  if (!res.ok) {
    return record('OpenRouter key', false, `rejected (${res.status})`);
  }

  const { data } = await res.json();
  const budget = data.limit === null ? 'no spend cap' : `$${(data.limit - data.usage).toFixed(2)} left`;
  record('OpenRouter key', true, `${data.label ?? 'key'} accepted, ${budget}`);
  record('OpenRouter model', true, c.cyan(env.OPENROUTER_MODEL));
}

async function checkDiscord() {
  if (isPlaceholder(env.DISCORD_WEBHOOK_URL)) {
    return record(
      'Discord webhook',
      false,
      'missing or still the placeholder',
      'Server Settings > Integrations > Webhooks > New Webhook > Copy Webhook URL',
    );
  }

  // GET on a webhook URL returns its metadata without posting anything to the channel.
  const res = await fetch(env.DISCORD_WEBHOOK_URL);
  if (!res.ok) {
    return record('Discord webhook', false, `rejected (${res.status})`, 'The URL is wrong or the webhook was deleted.');
  }

  const hook = await res.json();
  record('Discord webhook', true, `"${hook.name}" is live in channel ${c.dim(hook.channel_id)}`);
}

async function checkDashboard() {
  const res = await fetch(`${env.DASHBOARD_URL}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
  record(
    'Dashboard',
    res?.ok ? true : 'warn',
    res?.ok ? `listening on ${env.DASHBOARD_URL}` : 'not running',
    res?.ok ? null : 'Optional. Start it with: npm run dashboard',
  );
}

console.log(`\n${c.bold('LEAD SNIPER · preflight')}\n`);

if (!env.hasFile) {
  console.log(c.amber('  No .env found. Copy .env.example to .env and fill it in.\n'));
}

await checkGithubQuota();
await checkRepoAndStarHeader();
await checkOpenRouter();
await checkDiscord();
await checkDashboard();

const failed = results.filter((r) => r.ok === false);
const warned = results.filter((r) => r.ok === 'warn');

console.log('');
if (failed.length) {
  console.log(c.red(`  ${failed.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}`));
  console.log(c.dim('  Fix these before importing the workflow into n8n.\n'));
  process.exit(1);
}
console.log(c.green(`  All checks passed${warned.length ? c.amber(` (${warned.length} warning)`) : ''}. Ready to run.\n`));
