import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/commands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('❌ Fehlende ENV Variablen!');
  console.error('Benötigt: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  try {
    console.log('🔄 Registriere Slash-Commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: commands.map((cmd) => cmd.toJSON()),
      }
    );

    console.log('✅ Slash-Commands erfolgreich registriert!');
  } catch (error) {
    console.error('❌ Fehler beim Registrieren:', error);
  }
}

main();
