import { EmbedBuilder } from 'discord.js';

const EMBED_COLOR = '#4B0082';

export function createModEmbed(mod) {
  return new EmbedBuilder()
    .setTitle('📦 Mod Update installiert')
    .setDescription(
      [
        `**${mod.title}**`,
        '',
        'Die Mod wurde erkannt und ist jetzt auf deinem Server aktiv.'
      ].join('\n')
    )
    .setURL(mod.url)
    .setColor(EMBED_COLOR)
    .addFields(
      { name: 'Mod ID', value: `\`${mod.id}\``, inline: true },
      { name: 'Status', value: 'Auf Server aktiv', inline: true },
      {
        name: 'Workshop',
        value: mod.url ? `[Zur Steam Workshop Seite](${mod.url})` : 'Nicht verfügbar',
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
    preview: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/221100/header.jpg',
  });
}
