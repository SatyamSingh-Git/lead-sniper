const sources = $('Build Pitch Prompt').all();

// The alert is the product; the pitch is a garnish. A model that is down, rate limited or
// simply feeling creative with its JSON must not cost us the lead, so every failure path
// lands on a template built from fields we already fetched.
function fallbackPitch({ profile, targetRepo }) {
  const where = profile.company ? ` at ${profile.company}` : '';
  return {
    pitch: `${profile.name || profile.login}${where} has ${profile.followers} followers across ${profile.publicRepos} public repos and just starred ${targetRepo} — worth a look.`,
    angle: 'reach and activity',
    confidence: 0.2,
    source: 'fallback',
  };
}

function parseContent(raw) {
  const stripped = String(raw ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed.pitch !== 'string' || !parsed.pitch.trim()) return null;
    return {
      pitch: parsed.pitch.trim().slice(0, 300),
      angle: String(parsed.angle ?? '').trim().slice(0, 40) || 'general fit',
      confidence: Number.isFinite(parsed.confidence) ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5,
      source: 'llm',
    };
  } catch {
    return null;
  }
}

return $input.all().map((item, index) => {
  const cfg = sources[index].json;
  const body = item.json.body ?? item.json;
  const content = body?.choices?.[0]?.message?.content;

  const pitch = parseContent(content) ?? fallbackPitch(cfg);

  return {
    json: {
      ...cfg,
      pitch: pitch.pitch,
      angle: pitch.angle,
      confidence: pitch.confidence,
      pitchSource: pitch.source,
      tokensUsed: body?.usage?.total_tokens ?? 0,
      modelUsed: body?.model ?? cfg.model,
    },
  };
});
