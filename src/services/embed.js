import { EmbedBuilder } from 'discord.js';

const EMBED_COLOR = '#4B0082';

export function createModEmbed(mod) {
  return new EmbedBuilder()
    .setTitle('📦 Mod Update Installed')
    .setDescription(
      [
        `**${mod.title}**`,
        '',
        'This mod update is now active on your server.'
      ].join('\n')
    )
    .setURL(mod.url)
    .setColor(EMBED_COLOR)
    .addFields(
      { name: 'Mod ID', value: `\`${mod.id}\``, inline: true },
      { name: 'Status', value: 'Installed on server', inline: true },
      {
        name: 'Workshop',
        value: `[View on Steam Workshop](${mod.url})`,
        inline: false
      }
    )
    .setImage(mod.preview || null)
    .setFooter({ text: 'DayZ Server Monitor' })
    .setTimestamp();
}

export function createTestModEmbed() {
  return createModEmbed({
    id: '1559212036',
    title: 'Expansion Mod (Test)',
    url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1559212036',
    preview: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/221100/header.jpg'
  });
}
