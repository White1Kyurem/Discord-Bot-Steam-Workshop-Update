import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commands } from './commands/commands.js';
import { runCheck } from './monitor/engine.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const config = {
  host: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  queryPort: Number(process.env.SERVER_QUERY_PORT),
  modIds: process.env.WORKSHOP_MOD_IDS
    ? process.env.WORKSHOP_MOD_IDS.split(',').map((id) => id.trim()).filter(Boolean)
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
    console.error('Fehlende ENV Variablen für Command-Registrierung.');
    console.error('Benötigt: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Registriere Slash-Commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands.map((cmd) => cmd.toJSON()) }
    );

    console.log('Slash-Commands erfolgreich registriert.');
  } catch (error) {
    console.error('Fehler beim Registrieren der Slash-Commands:', error);
  }
}

client.once('clientReady', async (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}`);

  await registerCommands();

  if (!config.host || !config.queryPort || config.modIds.length === 0) {
    console.warn('Monitoring nicht gestartet: SERVER_HOST, SERVER_QUERY_PORT oder WORKSHOP_MOD_IDS fehlen.');
    return;
  }

  setInterval(async () => {
    if (!notificationsEnabled) return;

    try {
      await runCheck(config, client);
    } catch (error) {
      console.error('Fehler im Monitor:', error);
    }
  }, config.pollInterval);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'status') {
      await interaction.reply({
        content: [
          `Bot: online`,
          `Notifications: ${notificationsEnabled ? 'an' : 'aus'}`,
          `Server Host: ${config.host || 'nicht gesetzt'}`,
          `Query Port: ${config.queryPort || 'nicht gesetzt'}`,
          `Mods geladen: ${config.modIds.length}`
        ].join('\n'),
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === 'notifications') {
      const state = interaction.options.getString('state', true);

      notificationsEnabled = state === 'on';

      await interaction.reply({
        content: `Benachrichtigungen sind jetzt **${notificationsEnabled ? 'AN' : 'AUS'}**.`,
        ephemeral: true
      });
      return;
    }
  } catch (error) {
    console.error('Fehler bei interactionCreate:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: 'Beim Ausführen des Commands ist ein Fehler passiert.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: 'Beim Ausführen des Commands ist ein Fehler passiert.',
        ephemeral: true
      });
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN fehlt.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
