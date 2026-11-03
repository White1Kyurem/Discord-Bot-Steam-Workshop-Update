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
import { getInstalledWorkshopState } from './services/server-workshop.js';

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
  pollInterval: Number(process.env.POLL_INTERVAL_SECONDS || 180) * 1000,
  onlineStableMs: Number(process.env.ONLINE_STABLE_SECONDS || 90) * 1000,
  dataDir: process.env.DATA_DIR || './data',
  sftp: {
    host: process.env.SERVER_SFTP_HOST || process.env.SERVER_HOST,
    port: Number(process.env.SERVER_SFTP_PORT || 8822),
    username: process.env.SERVER_SFTP_USERNAME,
    password: process.env.SERVER_SFTP_PASSWORD,
    workshopAcfPath:
      process.env.SERVER_WORKSHOP_ACF_PATH ||
      'steamapps/workshop/appworkshop_221100.acf',
    readyTimeout: Number(process.env.SFTP_READY_TIMEOUT_MS || 20000),
    searchRoot: process.env.SERVER_SFTP_SEARCH_ROOT || '.',
    searchDepth: Number(process.env.SERVER_SFTP_SEARCH_DEPTH || 6),
    searchMaxDirectories: Number(
      process.env.SERVER_SFTP_SEARCH_MAX_DIRECTORIES || 300
    )
  }
};

let notificationsEnabled = true;
let checkInProgress = false;

async function runMonitorCheck() {
  if (checkInProgress) {
    console.warn('Skipping monitor check because the previous check is still running.');
    return;
  }

  checkInProgress = true;

  try {
    await runCheck(
      {
        ...config,
        notificationsEnabled
      },
      client
    );
  } catch (error) {
    console.error('Monitor error:', error);
  } finally {
    checkInProgress = false;
  }
}

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

  if (
    !config.sftp.host ||
    !config.sftp.username ||
    !config.sftp.password
  ) {
    console.warn(
      'SFTP install verification is not configured. Updates will be detected, but never announced until the SFTP variables are set.'
    );
  }

  await runMonitorCheck();
  setInterval(runMonitorCheck, config.pollInterval);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // =========================
    // STATUS
    // =========================
    if (interaction.commandName === 'status') {
      const monitor = getMonitorStatus();

      await interaction.reply({
        content: [
          `🤖 Bot: online`,
          `🔔 Notifications: ${notificationsEnabled ? 'enabled' : 'disabled'}`,
          `🌐 Server: ${config.host || 'not set'}`,
          `📡 Query Port: ${config.queryPort || 'not set'}`,
          `📦 Loaded Mods: ${config.modIds.length}`,
          `🕒 Pending Updates: ${monitor.pendingCount}`,
          `🔁 Waiting for offline cycle: ${monitor.awaitingOfflineCount}`,
          `🔻 Offline cycle detected: ${monitor.offlineSeenCount}`,
          `✅ Installed before server start: ${monitor.verifiedAtOnlineCount}`,
          `🔐 SFTP verification: ${
            config.sftp.username && config.sftp.password
              ? 'configured'
              : 'not configured'
          }`,
          `📄 Manifest path: ${
            monitor.lastManifestPath ||
            config.sftp.workshopAcfPath ||
            'not found yet'
          }`,
          `🧾 Last verification: ${monitor.lastVerificationAt || 'not yet'}`,
          `⚠️ Verification error: ${monitor.lastVerificationError || 'none'}`,
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
    // SFTP MANIFEST TEST
    // =========================
    if (interaction.commandName === 'checkmanifest') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const installedState = await getInstalledWorkshopState(config.sftp);

        await interaction.editReply({
          content: [
            '✅ Server Workshop manifest verification succeeded.',
            `📄 Path: \`${installedState.path}\``,
            `📦 Installed Workshop items found: **${installedState.items.size}**`
          ].join('\n')
        });
      } catch (error) {
        await interaction.editReply({
          content:
            '❌ Server Workshop manifest verification failed.\n' +
            `\`${String(error?.message || error).slice(0, 1500)}\``
        });
      }

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

