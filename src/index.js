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
import {
  createNotificationContent,
  createTestModEmbed
} from './services/embed.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function extractNumericId(value) {
  if (!value) return '';

  const text = String(value).trim();
  const urlMatch = text.match(/[?&]id=(\d+)/i);
  const numericMatch = text.match(/\d{5,}/);
  return urlMatch?.[1] || numericMatch?.[0] || '';
}

function envBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

const configuredModIds = process.env.WORKSHOP_MOD_IDS
  ? process.env.WORKSHOP_MOD_IDS.split(',')
      .map(extractNumericId)
      .filter(Boolean)
  : [];

const config = {
  host: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  queryPort: Number(process.env.SERVER_QUERY_PORT),
  collectionId: extractNumericId(process.env.WORKSHOP_COLLECTION_ID),
  modIds: configuredModIds,
  channelId: extractNumericId(process.env.ANNOUNCE_CHANNEL_ID),
  roleId: extractNumericId(process.env.NOTIFY_ROLE_ID),
  pollInterval: Number(process.env.POLL_INTERVAL_SECONDS || 180) * 1000,
  onlineStableSeconds: Number(process.env.ONLINE_STABLE_SECONDS || 90),
  requireOfflineCycle: envBoolean(process.env.REQUIRE_OFFLINE_CYCLE, true),
  dataDir: process.env.DATA_DIR || './data'
};

let notificationsEnabled = true;
let checkRunning = false;

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

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands.map((cmd) => cmd.toJSON())
    });

    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

async function executeMonitorCheck() {
  if (!notificationsEnabled || checkRunning) return;

  checkRunning = true;

  try {
    await runCheck(config, client);
  } catch (error) {
    console.error('Monitor error:', error);
  } finally {
    checkRunning = false;
  }
}

client.once('clientReady', async (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);

  await registerCommands();

  const hasModSource = Boolean(config.collectionId || config.modIds.length > 0);

  if (!config.host || !config.queryPort || !hasModSource) {
    console.warn(
      'Monitoring not started: SERVER_HOST, SERVER_QUERY_PORT and either WORKSHOP_COLLECTION_ID or WORKSHOP_MOD_IDS are required.'
    );
    return;
  }

  if (!config.collectionId) {
    console.warn(
      'WORKSHOP_COLLECTION_ID is not set. Automatic add/remove detection only works when WORKSHOP_MOD_IDS or the environment is changed.'
    );
  }

  await executeMonitorCheck();
  setInterval(executeMonitorCheck, config.pollInterval);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'status') {
      const monitor = getMonitorStatus();

      const onlineTime = monitor.onlineSinceAfterPendingRestart
        ? Math.floor(
            (Date.now() - monitor.onlineSinceAfterPendingRestart) / 1000
          )
        : 0;

      await interaction.reply({
        content: [
          '🤖 Bot: online',
          `🔔 Notifications: ${notificationsEnabled ? 'enabled' : 'disabled'}`,
          `🌐 Server: ${config.host || 'not set'}`,
          `📡 Query Port: ${config.queryPort || 'not set'}`,
          `📚 Mod Source: ${monitor.source}`,
          `📦 Tracked Mods: ${monitor.trackedCount}`,
          `🕒 Pending Changes: ${monitor.pendingCount}`,
          `   • Updates: ${monitor.pendingUpdated}`,
          `   • Installed: ${monitor.pendingInstalled}`,
          `   • Uninstalled: ${monitor.pendingUninstalled}`,
          `🔁 Restart Required: ${
            monitor.requiresOfflineCycleForPending ? 'yes' : 'no'
          }`,
          `🔻 Offline detected: ${
            monitor.offlineSeenAfterPending ? 'yes' : 'no'
          }`,
          `⏱ Online after restart: ${
            monitor.onlineSinceAfterPendingRestart
              ? `${onlineTime} seconds`
              : 'not yet'
          }`,
          `📢 Channel: ${config.channelId || 'not set'}`,
          `🔔 Mentioned Role: ${
            config.roleId ? `<@&${config.roleId}>` : 'not set'
          }`
        ].join('\n'),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.commandName === 'notifications') {
      const selectedState = interaction.options.getString('state', true);
      notificationsEnabled = selectedState === 'on';

      await interaction.reply({
        content: `Notifications are now **${
          notificationsEnabled ? 'ENABLED' : 'DISABLED'
        }**.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

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

      const testType =
        interaction.options.getString('type', false) || 'updated';

      const message = {
        content: createNotificationContent(testType, config.roleId),
        embeds: [createTestModEmbed(testType)]
      };

      if (config.roleId) {
        message.allowedMentions = { roles: [config.roleId] };
      }

      await channel.send(message);

      await interaction.reply({
        content: `Test ${testType} notification sent successfully.`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const response = {
      content: 'An error occurred while executing this command.',
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
