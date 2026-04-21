import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Benachrichtigungen ein- oder ausschalten')
    .addStringOption((option) =>
      option
        .setName('state')
        .setDescription('on oder off')
        .setRequired(true)
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' }
        )
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Zeigt den aktuellen Bot-Status an'),

  new SlashCommandBuilder()
    .setName('testupdate')
    .setDescription('Sendet ein Test-Embed in den eingestellten Ankündigungs-Channel')
];
