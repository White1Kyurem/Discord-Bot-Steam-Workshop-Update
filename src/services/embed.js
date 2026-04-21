import { EmbedBuilder } from "discord.js";

export function createModEmbed(mod) {
  return new EmbedBuilder()
    .setTitle("📦 Mod Update Installed")
    .setDescription(`**${mod.title}**\nJetzt auf dem Server aktiv`)
    .setURL(mod.url)
    .setColor("#5A0F7A")
    .setImage(mod.preview)
    .setFooter({ text: "DayZ Server Monitor" })
    .setTimestamp();
}
