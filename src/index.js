import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags
} from 'discord.js';

import { commands } from './commands/commands.js';
import { runCheck, getMonitorStatus } from './monitor/engine.js';
import { createTestModEmbed } from './services/embed.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const config = {
  host: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  queryPort: Number(process.env.SERVER_QUERY_PORT),
  modIds: process.env.WORKSHOP_MOD_IDS
    ? process.env.WORKSHOP_MOD_IDS.split(',').map(id => id.trim()).filter(Boolean)
    : [],
  channelId: process.env.ANNOUNCE_CHANNEL_ID,
  pollInterval: Number(process.env.POLL_INTERVAL_SECONDS || 180) * 1000
};

let notificationsEnabled = true;

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.error('Missing ENV variables for command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

client.once('clientReady', async (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);

  await registerCommands();

  if (!config.host || !config.queryPort || config.modIds.length === 0) {
    console.warn('Monitoring not started: missing server config or mods.');
    return;
  }

  setInterval(async () => {
    if (!notificationsEnabled) return;

    try {
      await runCheck(config, client);
    } catch (error) {
      console.error('Monitor error:', error);
    }
  }, config.pollInterval);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // =========================
    // STATUS
    // =========================
    if (interaction.commandName === 'status') {
      const monitor = getMonitorStatus();

      const onlineTime = monitor.onlineSinceAfterPendingRestart
        ? Math.floor((Date.now() - monitor.onlineSinceAfterPendingRestart) / 1000)
        : 0;

      await interaction.reply({
        content: [
          `🤖 Bot: online`,
          `🔔 Notifications: ${notificationsEnabled ? 'enabled' : 'disabled'}`,
          `🌐 Server: ${config.host || 'not set'}`,
          `📡 Query Port: ${config.queryPort || 'not set'}`,
          `📦 Loaded Mods: ${config.modIds.length}`,
          `🕒 Pending Updates: ${monitor.pendingCount}`,
          `🔁 Restart Required: ${monitor.requiresOfflineCycleForPending ? 'yes' : 'no'}`,
          `🔻 Offline detected: ${monitor.offlineSeenAfterPending ? 'yes' : 'no'}`,
          `⏱ Online after restart: ${
            monitor.onlineSinceAfterPendingRestart
              ? `${onlineTime} seconds`
              : 'not yet'
          }`,
          `📢 Channel: ${config.channelId || 'not set'}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // =========================
    // NOTIFICATIONS
    // =========================
    if (interaction.commandName === 'notifications') {
      const state = interaction.options.getString('state', true);
      notificationsEnabled = state === 'on';

      await interaction.reply({
        content: `Notifications are now **${notificationsEnabled ? 'ENABLED' : 'DISABLED'}**.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // =========================
    // TEST UPDATE
    // =========================
    if (interaction.commandName === 'testupdate') {
      if (!config.channelId) {
        await interaction.reply({
          content: 'ANNOUNCE_CHANNEL_ID is not set.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const channel = await client.channels.fetch(config.channelId);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: 'Channel not found or not a text channel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await channel.send({ embeds: [createTestModEmbed()] });

      await interaction.reply({
        content: 'Test update sent successfully.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

  } catch (error) {
    console.error('Interaction error:', error);

    await interaction.reply({
      content: 'An error occurred while executing this command.',
      flags: MessageFlags.Ephemeral
    });
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
