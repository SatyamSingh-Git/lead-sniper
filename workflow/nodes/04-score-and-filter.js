// Keyed by login rather than zipped by index: if anything is ever inserted between the
// selector and the enrichment call, index alignment would pair leads with the wrong profile
// and the mistake would be invisible.
const sources = new Map($('Select New Stargazers').all().map((item) => [item.json.login, item.json]));

// Yellow.ai's actual market. A bio mentioning these is a warmer lead than raw follower count.
const ICP_KEYWORDS = [
  'ai', 'llm', 'agent', 'chatbot', 'conversational', 'genai', 'nlp',
  'customer support', 'customer experience', 'cx', 'automation', 'voice',
];

const YEAR_MS = 365.25 * 864e5;
const cap = (value, max) => Math.min(Math.max(value, 0), max);

function scoreProfile(user) {
  const haystack = `${user.bio ?? ''} ${user.company ?? ''}`.toLowerCase();
  const icpHits = ICP_KEYWORDS.filter((word) => haystack.includes(word));

  const parts = {
    // Log-scaled so a 50k-follower celebrity does not flatten every other signal.
    followers: cap((Math.log10(Math.max(user.followers, 1)) / 4) * 30, 30),
    repos: cap((user.public_repos / 100) * 15, 15),
    tenure: cap((Date.now() - Date.parse(user.created_at)) / YEAR_MS, 10),
    active: Date.now() - Date.parse(user.updated_at) < 90 * 864e5 ? 10 : 0,
    reachable: user.email || user.blog || user.twitter_username ? 10 : 0,
    company: user.company ? 10 : 0,
    icp: cap(icpHits.length * 5, 15),
  };

  const total = Math.round(Object.values(parts).reduce((sum, n) => sum + n, 0));
  const tier = total >= 75 ? 'HOT' : total >= 50 ? 'WARM' : 'COLD';

  return { total, tier, icpHits, parts };
}

return $input.all().flatMap((item) => {
  const user = item.json.body ?? item.json;
  const cfg = sources.get(user?.login);

  // An account can be deleted or renamed between the stargazer listing and this enrichment
  // call, which comes back as an error body with no login. Drop that one lead rather than
  // failing the whole run and blocking everyone else in the batch.
  if (!cfg) return [];

  const score = scoreProfile(user);

  // The assignment's gate, exactly as written. The score above only ranks what gets through.
  const qualified = user.followers > cfg.minFollowers || user.public_repos > cfg.minRepos;

  return [{
    json: {
      ...cfg,
      qualified,
      gate: qualified
        ? user.followers > cfg.minFollowers
          ? `followers ${user.followers} > ${cfg.minFollowers}`
          : `public_repos ${user.public_repos} > ${cfg.minRepos}`
        : `followers ${user.followers} and public_repos ${user.public_repos} both below threshold`,
      score: score.total,
      tier: score.tier,
      icpHits: score.icpHits,
      scoreParts: score.parts,
      profile: {
        login: user.login,
        name: user.name,
        company: user.company,
        blog: user.blog,
        location: user.location,
        email: user.email,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        htmlUrl: user.html_url,
        followers: user.followers,
        publicRepos: user.public_repos,
        publicGists: user.public_gists,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    },
  }];
});
