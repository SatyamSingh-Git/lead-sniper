import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULTS = {
  GITHUB_REPO: 'fastapi/fastapi',
  GITHUB_API_BASE: 'https://api.github.com',
  OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_MODEL: 'deepseek/deepseek-v4-flash-0731',
  DASHBOARD_URL: 'http://localhost:8787',
  MIN_FOLLOWERS: '100',
  MIN_REPOS: '50',
  MAX_ENRICH_PER_RUN: '20',
  COLD_START_MAX_LEADS: '3',
  RATE_LIMIT_RESERVE: '250',
  BOOTSTRAP_LOOKBACK_HOURS: '24',
};

export function loadEnv() {
  const file = join(root, '.env');
  const parsed = {};

  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      parsed[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  return { ...DEFAULTS, ...parsed, ...pickFromProcess(), hasFile: existsSync(file) };
}

function pickFromProcess() {
  const picked = {};
  for (const key of Object.keys(DEFAULTS).concat([
    'GITHUB_TOKEN',
    'OPENROUTER_API_KEY',
    'DISCORD_WEBHOOK_URL',
  ])) {
    if (process.env[key]) picked[key] = process.env[key];
  }
  return picked;
}
