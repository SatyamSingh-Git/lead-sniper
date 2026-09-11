// Plays a realistic run into the dashboard: two free 304 polls, then a poll with new stars,
// enrichment, scoring, and delivery. Used to verify the UI and to film the demo without
// waiting for a stranger to star the repo on cue.
import { loadEnv } from './lib/env.js';

const env = loadEnv();
const base = env.DASHBOARD_URL;
const speed = Number(process.argv.find((a) => a.startsWith('--speed='))?.split('=')[1] ?? 1);

const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

async function emit(event) {
  await fetch(`${base}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {
    console.error(`  cannot reach ${base} — start it with: npm run dashboard`);
    process.exit(1);
  });
}

const CAST = [
  {
    login: 'sindresorhus', name: 'Sindre Sorhus', company: '@sindresorhus', location: 'Norway',
    email: null, blog: 'https://sindresorhus.com',
    bio: 'Full-Time Open-Sourcerer. Focused on developer tooling and automation.',
    followers: 62400, publicRepos: 1180, createdAt: '2010-06-05T00:00:00Z',
    avatarUrl: 'https://avatars.githubusercontent.com/u/170270?v=4',
    htmlUrl: 'https://github.com/sindresorhus',
    pitch: 'Maintains developer tooling at enormous reach and works in automation daily, so our agent platform lands in exactly his wheelhouse.',
    angle: 'automation tooling', confidence: 0.91, tokens: 438,
  },
  {
    login: 'rasa-anya', name: 'Anya Kowalski', company: 'Helio Support Cloud', location: 'Berlin',
    email: 'anya@helio.io', blog: 'https://anya.dev',
    bio: 'Building conversational AI and LLM agents for customer support teams. Ex-NLP research.',
    followers: 840, publicRepos: 74, createdAt: '2014-03-19T00:00:00Z',
    avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
    htmlUrl: 'https://github.com/rasa-anya',
    pitch: 'Builds conversational AI for support teams at Helio, making her both a direct practitioner and a likely buyer of our platform.',
    angle: 'CX practitioner', confidence: 0.94, tokens: 401,
  },
  {
    login: 'quietbuilder', name: 'Marco Ferreira', company: null, location: 'Lisbon',
    email: null, blog: '',
    bio: 'I ship small things.',
    followers: 118, publicRepos: 9, createdAt: '2019-11-02T00:00:00Z',
    avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
    htmlUrl: 'https://github.com/quietbuilder',
    pitch: 'Marco Ferreira has 118 followers across 9 public repos and just starred the repo — worth a look.',
    angle: 'reach and activity', confidence: 0.2, tokens: 0, fallback: true,
  },
];

const REJECTS = [
  { login: 'driveby', followers: 4, publicRepos: 2, score: 18 },
  { login: 'newacct2026', followers: 0, publicRepos: 1, score: 11 },
  { login: 'stargazer99', followers: 31, publicRepos: 12, score: 34 },
];

function scoreFor(person) {
  const cap = (v, m) => Math.min(Math.max(v, 0), m);
  const hay = `${person.bio} ${person.company ?? ''}`.toLowerCase();
  const icpHits = ['ai', 'llm', 'agent', 'conversational', 'automation', 'nlp', 'customer support']
    .filter((k) => hay.includes(k));
  const parts = {
    followers: cap((Math.log10(Math.max(person.followers, 1)) / 4) * 30, 30),
    repos: cap((person.publicRepos / 100) * 15, 15),
    tenure: cap((Date.now() - Date.parse(person.createdAt)) / (365.25 * 864e5), 10),
    active: 10,
    reachable: person.email || person.blog ? 10 : 0,
    company: person.company ? 10 : 0,
    icp: cap(icpHits.length * 5, 15),
  };
  const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  return { total, tier: total >= 75 ? 'HOT' : total >= 50 ? 'WARM' : 'COLD', icpHits, parts };
}

const REPO = env.GITHUB_REPO;
const TOTAL_STARS = 88057;
let remaining = 4931;
let poll = 0;

console.log(`\n  replaying a run into ${base}\n`);

// Two polls where nothing changed. Revalidation returns 304 and costs no quota at all,
// which is why the budget line does not move here.
for (let i = 0; i < 2; i++) {
  poll += 1;
  await emit({ type: 'poll', poll, repo: REPO, totalStars: TOTAL_STARS, scanned: 0, newCount: 0,
    halt: true, reason: 'not_modified', notModified: true, remaining, reset: Math.floor(Date.now() / 1000) + 2160 });
  console.log(`  poll ${poll}  304 not modified  ·  0 quota`);
  await wait(1600);
}

poll += 1;
remaining -= 2;
const newCount = CAST.length + REJECTS.length;
await emit({ type: 'poll', poll, repo: REPO, totalStars: TOTAL_STARS, scanned: 100, newCount,
  halt: false, reason: null, notModified: false, remaining, reset: Math.floor(Date.now() / 1000) + 2160 });
console.log(`  poll ${poll}  200 ok  ·  ${newCount} new stars`);
await wait(1200);

const queue = [
  ...REJECTS.map((r) => ({ reject: r })),
  ...CAST.map((person) => ({ person })),
].sort(() => Math.random() - 0.5);

for (const entry of queue) {
  remaining -= 1;

  if (entry.reject) {
    const { login, followers, publicRepos, score } = entry.reject;
    await emit({
      type: 'score', login, score, tier: 'COLD', qualified: false,
      gate: `followers ${followers} and public_repos ${publicRepos} both below threshold`,
      icpHits: [], scoreParts: {}, starredAt: minutesAgo(3),
      profile: { login, name: null, bio: null, company: null, location: null, followers,
        publicRepos, createdAt: '2026-01-01T00:00:00Z', avatarUrl: '', htmlUrl: `https://github.com/${login}` },
    });
    console.log(`  skip  ${login.padEnd(16)} score ${score}`);
    await wait(700);
    continue;
  }

  const person = entry.person;
  const score = scoreFor(person);
  await emit({
    type: 'score', login: person.login, score: score.total, tier: score.tier, qualified: true,
    gate: person.followers > 100 ? `followers ${person.followers} > 100` : `public_repos ${person.publicRepos} > 50`,
    icpHits: score.icpHits, scoreParts: score.parts, starredAt: minutesAgo(2),
    profile: { ...person },
  });
  console.log(`  lead  ${person.login.padEnd(16)} score ${score.total} ${score.tier}`);
  await wait(1100);

  await emit({
    type: 'delivered', login: person.login, status: 204, pitch: person.pitch, angle: person.angle,
    confidence: person.confidence, pitchSource: person.fallback ? 'fallback' : 'llm',
    tokensUsed: person.tokens, modelUsed: person.fallback ? 'template' : env.OPENROUTER_MODEL,
  });
  console.log(`  sent  ${person.login.padEnd(16)} discord 204`);
  await wait(900);
}

console.log(`\n  done. ${CAST.length} leads delivered, ${REJECTS.length} filtered out.\n`);
