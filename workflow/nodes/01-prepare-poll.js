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

// The repository events feed, not /stargazers. GitHub now answers /stargazers with 404 for
// any repo you do not own, at every size — so the documented endpoint cannot watch someone
// else's project. Events still carry every star as a WatchEvent, work on any public repo,
// come back newest-first, and support the same ETag revalidation.
const eventsUrl = `${cfg.apiBase}/repos/${owner}/${name}/events?per_page=100`;

return [
  {
    json: {
      ...cfg,
      owner,
      name,
      eventsUrl,
      eventsEtag: state.etags[eventsUrl] ?? '',
      lastStarredAt: state.lastStarredAt,
      poll: state.polls,
      coldStart,
    },
  },
];
