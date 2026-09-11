import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, root } from './lib/env.js';

const env = loadEnv();
const src = (file) => readFileSync(join(root, 'workflow', 'nodes', file), 'utf8');

const GITHUB_CRED = { httpHeaderAuth: { id: 'lead-sniper-github', name: 'GitHub PAT (Header Auth)' } };
const OPENROUTER_CRED = { httpHeaderAuth: { id: 'lead-sniper-openrouter', name: 'OpenRouter (Header Auth)' } };

const PLACEHOLDER_WEBHOOK = 'https://discord.com/api/webhooks/REPLACE/WITH_YOUR_WEBHOOK';

let cursor = 0;
const at = (col, row = 0) => [col * 240, row * 190];

function code(name, file, position) {
  return {
    parameters: { jsCode: src(file) },
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function http(name, position, parameters, extras = {}) {
  return {
    parameters: {
      options: {
        response: { response: { fullResponse: true, neverError: true } },
      },
      ...parameters,
    },
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    ...extras,
  };
}

function ifNode(name, position, leftValue, rightValue, type) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: `${name}-cond`,
            leftValue,
            rightValue,
            operator: { type, operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
  };
}

function noOp(name, position) {
  return {
    parameters: {},
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position,
  };
}

function telemetry(name, position, fields, extras = {}) {
  return http(name, position, {
    method: 'POST',
    url: `={{ $('Config').first().json.dashboardUrl }}/event`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify(${fields}) }}`,
    options: {
      // The dashboard is an observer. If it is down, or slow, the pipeline must not care.
      response: { response: { fullResponse: false, neverError: true } },
      timeout: 2000,
    },
  }, extras);
}

const githubHeaders = (extra = []) => ({
  sendHeaders: true,
  headerParameters: {
    parameters: [
      // Without star+json the response is a bare user array with no starred_at, and there
      // is no timestamp to dedupe successive polls against.
      { name: 'Accept', value: 'application/vnd.github.star+json' },
      { name: 'X-GitHub-Api-Version', value: '2022-11-28' },
      ...extra,
    ],
  },
});

function buildConfig(webhookUrl) {
  const values = [
    ['targetRepo', env.GITHUB_REPO, 'string'],
    // Point this at the local mock to run the whole pipeline with no token and no quota.
    ['apiBase', env.GITHUB_API_BASE, 'string'],
    ['discordWebhookUrl', webhookUrl, 'string'],
    ['dashboardUrl', env.DASHBOARD_URL, 'string'],
    ['model', env.OPENROUTER_MODEL, 'string'],
    // Configurable so the flow can be pointed at the offline mock, or another
    // OpenAI-compatible provider, without editing a node.
    ['llmUrl', env.OPENROUTER_URL, 'string'],
    ['minFollowers', Number(env.MIN_FOLLOWERS), 'number'],
    ['minRepos', Number(env.MIN_REPOS), 'number'],
    ['maxEnrichPerRun', Number(env.MAX_ENRICH_PER_RUN), 'number'],
    ['coldStartMaxLeads', Number(env.COLD_START_MAX_LEADS), 'number'],
    ['rateLimitReserve', Number(env.RATE_LIMIT_RESERVE), 'number'],
    ['bootstrapLookbackHours', Number(env.BOOTSTRAP_LOOKBACK_HOURS), 'number'],
  ];

  return {
    parameters: {
      assignments: {
        assignments: values.map(([name, value, type]) => ({ id: `cfg-${name}`, name, value, type })),
      },
      options: {},
    },
    id: 'config',
    name: 'Config',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: at(1),
  };
}

function buildWorkflow(webhookUrl) {
  const nodes = [
    {
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
      id: 'schedule-trigger',
      name: 'Every 5 Minutes',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: at(0, 0),
    },
    {
      parameters: {},
      id: 'manual-trigger',
      name: 'Run Once (Demo)',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: at(0, 1),
    },
    buildConfig(webhookUrl),
    code('Prepare Poll', '01-prepare-poll.js', at(2)),

    http(
      'Probe Stargazers',
      at(3),
      {
        method: 'GET',
        url: '={{ $json.probeUrl }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        ...githubHeaders([{ name: 'If-None-Match', value: '={{ $json.probeEtag }}' }]),
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          redirect: { redirect: { followRedirects: true } },
        },
      },
      { credentials: GITHUB_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 },
    ),

    ifNode('Stargazers Changed?', at(4), '={{ $json.statusCode }}', 304, 'number'),
    noOp('No New Stars (0 quota)', at(5, 1)),

    // The 304 path is the one that runs most of the time, so it has to report itself —
    // otherwise the cheapest thing the pipeline does would be invisible on the dashboard.
    telemetry(
      'Telemetry: Not Modified',
      at(5, 2),
      `{ type: 'poll', poll: $('Prepare Poll').first().json.poll, repo: $('Config').first().json.targetRepo, scanned: 0, newCount: 0, halt: true, reason: 'not_modified', notModified: true, remaining: Number($json.headers['x-ratelimit-remaining'] || -1), reset: Number($json.headers['x-ratelimit-reset'] || 0) }`,
    ),

    code('Resolve Last Page', '02-resolve-last-page.js', at(5)),

    http(
      'Fetch Newest Page',
      at(6),
      {
        method: 'GET',
        url: '={{ $json.pageUrl }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        ...githubHeaders([{ name: 'If-None-Match', value: '={{ $json.pageEtag }}' }]),
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          redirect: { redirect: { followRedirects: true } },
        },
      },
      { credentials: GITHUB_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 },
    ),

    code('Select New Stargazers', '03-select-new-stargazers.js', at(7)),

    telemetry(
      'Telemetry: Poll',
      at(7, 2),
      `{ type: 'poll', poll: $json.poll, repo: $json.targetRepo, totalStars: $json.totalStars, scanned: $json.scanned, newCount: $json.newCount, halt: $json.halt, reason: $json.reason || null, remaining: $json.remaining, reset: $json.reset, notModified: false }`,
      // Select New Stargazers emits one item per lead, so without executeOnce this node
      // posts one duplicate poll event per lead and the funnel counts everything N times.
      { executeOnce: true },
    ),

    ifNode('Has New Leads?', at(8), '={{ $json.halt }}', false, 'boolean'),
    noOp('Run Halted', at(9, 1)),

    http(
      'Enrich Profile',
      at(9),
      {
        method: 'GET',
        url: '={{ $json.userUrl }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        ...githubHeaders(),
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          // Serialized, not parallel. GitHub's secondary rate limits are about concurrency
          // and burst, and they fire well below the 5,000/hour primary quota.
          batching: { batch: { batchSize: 1, batchInterval: 800 } },
        },
      },
      { credentials: GITHUB_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 },
    ),

    code('Score And Filter', '04-score-and-filter.js', at(10)),

    telemetry(
      'Telemetry: Score',
      at(10, 2),
      `{ type: 'score', login: $json.login, score: $json.score, tier: $json.tier, qualified: $json.qualified, gate: $json.gate, icpHits: $json.icpHits, scoreParts: $json.scoreParts, profile: $json.profile, starredAt: $json.starredAt }`,
    ),

    ifNode('Qualified?', at(11), '={{ $json.qualified }}', true, 'boolean'),
    noOp('Below Threshold', at(12, 1)),

    code('Build Pitch Prompt', '05-build-prompt.js', at(12)),

    http(
      'Generate Pitch',
      at(13),
      {
        method: 'POST',
        url: '={{ $json.llmUrl }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'HTTP-Referer', value: 'https://github.com/lead-sniper' },
            { name: 'X-Title', value: 'Lead Sniper' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.requestBody) }}',
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          batching: { batch: { batchSize: 1, batchInterval: 400 } },
          timeout: 20000,
        },
      },
      { credentials: OPENROUTER_CRED, retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 },
    ),

    code('Parse Pitch', '06-parse-pitch.js', at(14)),
    code('Format Discord Alert', '07-discord-embed.js', at(15)),

    http('Send To Discord', at(16), {
      method: 'POST',
      url: '={{ $json.webhookUrl }}',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.payload) }}',
      options: {
        response: { response: { fullResponse: true, neverError: true } },
        batching: { batch: { batchSize: 1, batchInterval: 400 } },
      },
    }),

    telemetry(
      'Telemetry: Delivered',
      at(16, 2),
      `{ type: 'delivered', login: $('Parse Pitch').all()[$itemIndex].json.login, status: $json.statusCode, pitch: $('Parse Pitch').all()[$itemIndex].json.pitch, angle: $('Parse Pitch').all()[$itemIndex].json.angle, confidence: $('Parse Pitch').all()[$itemIndex].json.confidence, pitchSource: $('Parse Pitch').all()[$itemIndex].json.pitchSource, tokensUsed: $('Parse Pitch').all()[$itemIndex].json.tokensUsed, modelUsed: $('Parse Pitch').all()[$itemIndex].json.modelUsed }`,
    ),

    code('Persist Cursor', '08-persist-state.js', at(17)),
  ];

  const wire = (from, targets) => ({
    main: targets.map((branch) =>
      (Array.isArray(branch) ? branch : [branch]).map((node) => ({ node, type: 'main', index: 0 })),
    ),
  });

  const connections = {
    'Every 5 Minutes': wire('Every 5 Minutes', [['Config']]),
    'Run Once (Demo)': wire('Run Once (Demo)', [['Config']]),
    Config: wire('Config', [['Prepare Poll']]),
    'Prepare Poll': wire('Prepare Poll', [['Probe Stargazers']]),
    'Probe Stargazers': wire('Probe Stargazers', [['Stargazers Changed?']]),
    // IF output 0 is the true branch: 304 means nothing changed, so the run ends there.
    'Stargazers Changed?': wire('Stargazers Changed?', [
      ['No New Stars (0 quota)', 'Telemetry: Not Modified'],
      ['Resolve Last Page'],
    ]),
    'Resolve Last Page': wire('Resolve Last Page', [['Fetch Newest Page']]),
    'Fetch Newest Page': wire('Fetch Newest Page', [['Select New Stargazers']]),
    'Select New Stargazers': wire('Select New Stargazers', [['Has New Leads?', 'Telemetry: Poll']]),
    'Has New Leads?': wire('Has New Leads?', [['Enrich Profile'], ['Run Halted']]),
    'Enrich Profile': wire('Enrich Profile', [['Score And Filter']]),
    'Score And Filter': wire('Score And Filter', [['Qualified?', 'Telemetry: Score']]),
    'Qualified?': wire('Qualified?', [['Build Pitch Prompt'], ['Below Threshold']]),
    'Build Pitch Prompt': wire('Build Pitch Prompt', [['Generate Pitch']]),
    'Generate Pitch': wire('Generate Pitch', [['Parse Pitch']]),
    'Parse Pitch': wire('Parse Pitch', [['Format Discord Alert']]),
    'Format Discord Alert': wire('Format Discord Alert', [['Send To Discord']]),
    'Send To Discord': wire('Send To Discord', [['Persist Cursor', 'Telemetry: Delivered']]),
  };

  return {
    // The editor's "Import from File" generates an id, but `n8n import:workflow` on the CLI
    // fails with a NOT NULL constraint without one. Shipping an id makes both paths work.
    id: 'LeadSniper000001',
    name: 'Lead Sniper — GitHub High-Value Lead Tracker',
    active: false,
    versionId: 'lead-sniper-v1',
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    pinData: {},
    meta: { instanceId: 'lead-sniper' },
    tags: [{ name: 'lead-sniper' }],
  };
}

const shipped = buildWorkflow(PLACEHOLDER_WEBHOOK);
const local = buildWorkflow(env.DISCORD_WEBHOOK_URL || PLACEHOLDER_WEBHOOK);

const shippedPath = join(root, 'workflow', 'lead-sniper.workflow.json');
const localPath = join(root, 'workflow', 'lead-sniper.local.json');

writeFileSync(shippedPath, `${JSON.stringify(shipped, null, 2)}\n`);
writeFileSync(localPath, `${JSON.stringify(local, null, 2)}\n`);

console.log(`built ${shipped.nodes.length} nodes`);
console.log(`  ${shippedPath}  (placeholders, safe to commit)`);
console.log(`  ${localPath}  (your webhook, gitignored)`);
