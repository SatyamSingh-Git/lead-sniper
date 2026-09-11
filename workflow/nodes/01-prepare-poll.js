const cfg = $input.first().json;
const state = $getWorkflowStaticData('global');
const [owner, name] = cfg.targetRepo.split('/');

state.etags ??= {};
state.seenLogins ??= [];
state.polls ??= 0;
state.notModified ??= 0;
state.savedRequests ??= 0;

// A popular repo has tens of thousands of stargazers. With no cursor we would alert on all
// of them, so the first run starts from a recent lookback instead of replaying history.
//
// Note this is also the state of EVERY manual execution: n8n only persists static data for
// production runs (`if (!isManualMode ...)` in its execution lifecycle hooks), so pressing
// "Test workflow" always cold-starts. Hence the separate, much smaller cold-start cap —
// without it a manual run on a busy repo fires a wall of duplicate alerts every time.
const coldStart = !state.lastStarredAt;
if (coldStart) {
  state.lastStarredAt = new Date(Date.now() - cfg.bootstrapLookbackHours * 3600e3).toISOString();
}

state.polls += 1;

// per_page=1 makes this the cheapest possible change-detector: the Link header's rel="last"
// page number is the total star count, and the ETag changes the moment that count does.
const probeUrl = `${cfg.apiBase}/repos/${owner}/${name}/stargazers?per_page=1`;

return [
  {
    json: {
      ...cfg,
      owner,
      name,
      probeUrl,
      probeEtag: state.etags[probeUrl] ?? '',
      lastStarredAt: state.lastStarredAt,
      poll: state.polls,
      coldStart,
    },
  },
];
