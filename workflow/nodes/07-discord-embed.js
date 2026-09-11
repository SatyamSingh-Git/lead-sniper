const TIER = {
  HOT: { color: 0xf5b301, mark: '🔥' },
  WARM: { color: 0x22d3ee, mark: '⚡' },
  COLD: { color: 0x64748b, mark: '💤' },
};

const clip = (value, max) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function contactLine({ email, blog }) {
  const parts = [];
  if (email) parts.push(email);
  if (blog) parts.push(blog.startsWith('http') ? blog : `https://${blog}`);
  return parts.join(' · ') || null;
}

return $input.all().map((item) => {
  const lead = item.json;
  const { profile } = lead;
  const tier = TIER[lead.tier] ?? TIER.COLD;

  const fields = [
    { name: 'Followers', value: `**${profile.followers.toLocaleString()}**`, inline: true },
    { name: 'Public repos', value: `**${profile.publicRepos}**`, inline: true },
    { name: 'Sniper score', value: `**${lead.score}**/100`, inline: true },
  ];

  if (profile.company) fields.push({ name: 'Company', value: clip(profile.company, 100), inline: true });
  if (profile.location) fields.push({ name: 'Location', value: clip(profile.location, 100), inline: true });

  // Discord renders <t:epoch:R> as a live relative timestamp in the reader's own timezone.
  fields.push({
    name: 'Starred',
    value: `<t:${Math.floor(Date.parse(lead.starredAt) / 1000)}:R>`,
    inline: true,
  });

  const contact = contactLine(profile);
  if (contact) fields.push({ name: 'Contact', value: clip(contact, 200), inline: false });

  fields.push({
    name: `${lead.pitchSource === 'llm' ? '🤖' : '📋'} Why reach out`,
    value: `> ${clip(lead.pitch, 1000)}`,
    inline: false,
  });

  const footer = [
    `${lead.angle}`,
    `confidence ${lead.confidence.toFixed(2)}`,
    lead.pitchSource === 'llm' ? lead.modelUsed : 'template fallback',
    `gate: ${lead.gate}`,
  ].join('  ·  ');

  return {
    json: {
      webhookUrl: lead.discordWebhookUrl,
      payload: {
        username: 'Lead Sniper',
        embeds: [
          {
            author: {
              name: `${tier.mark} ${lead.tier} LEAD  ·  ${lead.score}/100`,
              icon_url: profile.avatarUrl,
            },
            title: profile.name ? `${profile.name}  ·  @${profile.login}` : `@${profile.login}`,
            url: profile.htmlUrl,
            description: clip(profile.bio, 500) ?? '_no bio_',
            color: tier.color,
            thumbnail: { url: profile.avatarUrl },
            fields,
            footer: { text: clip(footer, 2000) },
            timestamp: lead.starredAt,
          },
        ],
      },
    },
  };
});
