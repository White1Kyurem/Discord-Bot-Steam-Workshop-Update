import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Enable or disable update notifications')
    .addStringOption((option) =>
      option
        .setName('state')
        .setDescription('Choose on or off')
        .setRequired(true)
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' }
        )
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot and server status'),

  new SlashCommandBuilder()
    .setName('testupdate')
    .setDescription('Send a test mod update embed')
];
