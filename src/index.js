import { Client, GatewayIntentBits } from "discord.js";
import { commands } from "./commands/commands.js";
import { runCheck } from "./monitor/engine.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const config = {
  host: process.env.SERVER_HOST,
  port: process.env.SERVER_PORT,
  queryPort: process.env.SERVER_QUERY_PORT,
  modIds: process.env.WORKSHOP_MOD_IDS.split(","),
  channelId: process.env.ANNOUNCE_CHANNEL_ID
};

client.once("clientReady", () => {
  console.log("Bot is online");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "notifications") {
    await interaction.reply("Feature active (demo)");
  }

  if (interaction.commandName === "status") {
    await interaction.reply("Bot is running");
  }
});

setInterval(() => runCheck(config, client), 180000);

client.login(process.env.DISCORD_TOKEN);
