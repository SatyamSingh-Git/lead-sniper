// Guards the submission artifact. The shipped workflow JSON is the one file that leaves
// this repo, so it gets checked for anything token-shaped before it goes anywhere.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib/env.js';

const PATTERNS = [
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'GitHub fine-grained token'],
  [/sk-or-v1-[A-Za-z0-9]{20,}/g, 'OpenRouter key'],
  [/sk-[A-Za-z0-9]{32,}/g, 'OpenAI-style key'],
  [/discord\.com\/api\/webhooks\/\d{5,}\/[\w-]{20,}/g, 'Discord webhook'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
];

const target = join(root, 'workflow', 'lead-sniper.workflow.json');

if (!existsSync(target)) {
  console.error('  no built workflow — run: npm run build');
  process.exit(1);
}

const content = readFileSync(target, 'utf8');
const found = [];

for (const [pattern, label] of PATTERNS) {
  for (const match of content.matchAll(pattern)) {
    found.push(`${label}: ${match[0].slice(0, 12)}…`);
  }
}

if (found.length) {
  console.error(`\n  ${found.length} secret(s) in the submission artifact:\n`);
  for (const line of found) console.error(`    ${line}`);
  console.error('\n  Do not submit this file.\n');
  process.exit(1);
}

console.log(`\n  clean — no secrets in ${target.split(/[\\/]/).pop()}\n`);
