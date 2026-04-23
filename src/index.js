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
    console.error('❌ Fehlende ENV Variablen für Command-Registrierung.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('🔄 Registriere Slash-Commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log('✅ Slash-Commands erfolgreich registriert.');
  } catch (error) {
    console.error('❌ Fehler beim Registrieren:', error);
  }
}

client.once('clientReady', async (readyClient) => {
  console.log(`🟢 Bot ist online als ${readyClient.user.tag}`);

  await registerCommands();

  if (!config.host || !config.queryPort || config.modIds.length === 0) {
    console.warn('⚠️ Monitoring nicht gestartet: Serverdaten oder Mods fehlen.');
    return;
  }

  setInterval(async () => {
    if (!notificationsEnabled) return;

    try {
      await runCheck(config, client);
    } catch (error) {
      console.error('❌ Fehler im Monitor:', error);
    }
  }, config.pollInterval);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // =========================
    // STATUS COMMAND
    // =========================
    if (interaction.commandName === 'status') {
      const monitor = getMonitorStatus();

      const onlineTime = monitor.onlineSinceAfterPendingRestart
        ? Math.floor((Date.now() - monitor.onlineSinceAfterPendingRestart) / 1000)
        : 0;

      await interaction.reply({
        content: [
          `🤖 Bot: online`,
          `🔔 Notifications: ${notificationsEnabled ? 'an' : 'aus'}`,
          `🌐 Server: ${config.host || 'nicht gesetzt'}`,
          `📡 Query Port: ${config.queryPort || 'nicht gesetzt'}`,
          `📦 Mods geladen: ${config.modIds.length}`,
          `🕒 Pending Updates: ${monitor.pendingCount}`,
          `🔁 Neuer Restart nötig: ${monitor.requiresOfflineCycleForPending ? 'ja' : 'nein'}`,
          `🔻 Offline gesehen: ${monitor.offlineSeenAfterPending ? 'ja' : 'nein'}`,
          `⏱ Online seit Restart: ${
            monitor.onlineSinceAfterPendingRestart
              ? `${onlineTime} Sekunden`
              : 'noch nicht'
          }`,
          `📢 Channel: ${config.channelId || 'nicht gesetzt'}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // =========================
    // NOTIFICATIONS COMMAND
    // =========================
    if (interaction.commandName === 'notifications') {
      const state = interaction.options.getString('state', true);
      notificationsEnabled = state === 'on';

      await interaction.reply({
        content: `🔔 Benachrichtigungen sind jetzt **${notificationsEnabled ? 'AN' : 'AUS'}**.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // =========================
    // TESTUPDATE COMMAND
    // =========================
    if (interaction.commandName === 'testupdate') {
      if (!config.channelId) {
        await interaction.reply({
          content: '❌ ANNOUNCE_CHANNEL_ID fehlt in Railway.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const channel = await client.channels.fetch(config.channelId);

      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: '❌ Channel nicht gefunden oder kein Textchannel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await channel.send({ embeds: [createTestModEmbed()] });

      await interaction.reply({
        content: '🧪 Test-Modupdate erfolgreich gesendet.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

  } catch (error) {
    console.error('❌ Fehler bei Interaction:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: '❌ Fehler beim Command.',
        flags: MessageFlags.Ephemeral
      });
    } else {
      await interaction.reply({
        content: '❌ Fehler beim Command.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
});

// =========================
// START BOT
// =========================
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN fehlt!');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
