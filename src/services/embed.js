import { EmbedBuilder } from 'discord.js';

const EMBED_COLOR = '#4B0082';

export function createModEmbed(mod) {
  return new EmbedBuilder()
    .setTitle('📦 Mod Update Installed')
    .setDescription(`**${mod.title}**\nJetzt auf dem Server aktiv`)
    .setURL(mod.url)
    .setColor(EMBED_COLOR)
    .setImage(mod.preview || null)
    .setFooter({ text: 'DayZ Server Monitor' })
    .setTimestamp();
}

export function createTestEmbed() {
  return new EmbedBuilder()
    .setTitle('🧪 Test Update')
    .setDescription('Dieser Test bestätigt, dass der Bot Nachrichten und Embeds korrekt senden kann.')
    .setColor(EMBED_COLOR)
    .addFields(
      { name: 'Discord Verbindung', value: 'OK', inline: true },
      { name: 'Slash Commands', value: 'OK', inline: true },
      { name: 'Ankündigungs-Channel', value: 'OK', inline: true }
    )
    .setFooter({ text: 'DayZ Server Monitor Test' })
    .setTimestamp();
}
