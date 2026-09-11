const state = $getWorkflowStaticData('global');
const leads = $('Score And Filter').all().map((item) => item.json);

if (leads.length === 0) return [{ json: { advanced: false } }];

// Written only after delivery. If the run dies halfway the cursor stays put and those
// stargazers are reprocessed next poll — for sales leads a duplicate alert is a far
// cheaper mistake than a silently dropped one.
const newest = leads
  .map((lead) => lead.starredAt)
  .reduce((latest, current) => (current > latest ? current : latest), state.lastStarredAt);

state.lastStarredAt = newest;

// Guards against duplicate alerts when two stars share a timestamp, or the clock skews.
// Bounded so staticData cannot grow without limit across thousands of polls.
state.seenLogins = [...state.seenLogins, ...leads.map((lead) => lead.login)].slice(-500);

return [
  {
    json: {
      advanced: true,
      cursor: state.lastStarredAt,
      processed: leads.length,
      qualified: leads.filter((lead) => lead.qualified).length,
      seenCount: state.seenLogins.length,
      polls: state.polls,
      notModified: state.notModified,
    },
  },
];
