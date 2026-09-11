const cfg = $('Prepare Poll').first().json;
const res = $input.first().json;
const state = $getWorkflowStaticData('global');

// ETags are cached per URL, not per repo: the per_page=1 probe and the per_page=100 page
// are different resources and their validators are not interchangeable.
if (res.headers.etag) state.etags[cfg.probeUrl] = res.headers.etag;

// Stargazers come back oldest-first, so the newest stars are on the LAST page. Polling
// page 1 forever returns whoever starred the repo in 2018.
const lastPageLink = (res.headers.link ?? '').match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
const totalStars = lastPageLink ? Number(lastPageLink[1]) : (res.body ?? []).length;
const lastPage = Math.max(1, Math.ceil(totalStars / 100));

const pageUrl = `${cfg.apiBase}/repos/${cfg.owner}/${cfg.name}/stargazers?per_page=100&page=${lastPage}`;

return [
  {
    json: {
      ...cfg,
      pageUrl,
      pageEtag: state.etags[pageUrl] ?? '',
      totalStars,
      lastPage,
      remaining: Number(res.headers['x-ratelimit-remaining'] ?? -1),
      reset: Number(res.headers['x-ratelimit-reset'] ?? 0),
    },
  },
];
