import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("notifications")
    .setDescription("Enable or disable notifications")
    .addStringOption(option =>
      option.setName("state")
        .setDescription("on/off")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" }
        )
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show bot status")
];
