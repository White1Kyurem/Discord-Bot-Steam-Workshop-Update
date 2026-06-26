import { EmbedBuilder } from 'discord.js';

const EMBED_COLOR = '#4B0082';

const EVENT_COPY = {
  updated: {
    title: '🔄 Mod Update Installed',
    description: 'A new update for this mod is now active on the server.',
    status: 'Update installed',
    mentionText: 'A mod update has been installed.'
  },
  installed: {
    title: '➕ New Mod Installed',
    description: 'This mod was newly installed and is now active on the server.',
    status: 'Newly installed',
    mentionText: 'A new mod has been installed.'
  },
  uninstalled: {
    title: '➖ Mod Uninstalled',
    description: 'This mod has been removed from the server.',
    status: 'Uninstalled',
    mentionText: 'A mod has been uninstalled.'
  }
};

export function createModEmbed(mod, eventType = 'updated') {
  const copy = EVENT_COPY[eventType] || EVENT_COPY.updated;

  const embed = new EmbedBuilder()
    .setTitle(copy.title)
    .setDescription(
      [
        `**${mod.title}**`,
        '',
        copy.description
      ].join('\n')
    )
    .setURL(mod.url)
    .setColor(EMBED_COLOR)
    .addFields(
      { name: 'Exact Mod Name', value: mod.title, inline: false },
      { name: 'Mod ID', value: `\`${mod.id}\``, inline: true },
      { name: 'Status', value: copy.status, inline: true },
      {
        name: 'Workshop',
        value: `[View on Steam Workshop](${mod.url})`,
        inline: false
      }
    )
    .setFooter({ text: 'DayZ Server Monitor' })
    .setTimestamp();

  if (mod.preview) {
    embed.setImage(mod.preview);
  }

  return embed;
}

export function createNotificationContent(eventType, roleId) {
  const copy = EVENT_COPY[eventType] || EVENT_COPY.updated;
  const roleMention = roleId ? `<@&${roleId}> ` : '';
  return `${roleMention}${copy.mentionText}`;
}

export function createTestModEmbed(eventType = 'updated') {
  return createModEmbed(
    {
      id: '1559212036',
      title: 'Expansion Mod (Test)',
      url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1559212036',
      preview:
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/221100/header.jpg'
    },
    eventType
  );
}
