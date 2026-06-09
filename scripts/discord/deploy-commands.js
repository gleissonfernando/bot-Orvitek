require('dotenv').config();

const { REST, Routes } = require('discord.js');
const commands = require('../../src/commands/setupCommands');

const discordToken = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
const requiredEnv = ['CLIENT_ID'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(`Variaveis ausentes no .env: ${missingEnv.join(', ')}`);
}

if (!discordToken) {
  throw new Error('Configure DISCORD_BOT_TOKEN ou DISCORD_TOKEN no .env.');
}

function guildCommandClearIds() {
  return String(process.env.GUILD_COMMAND_CLEAR_IDS || process.env.GUILD_ID || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const body = commands.map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(discordToken);

async function main() {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body
  });

  const clearedGuilds = guildCommandClearIds();
  for (const guildId of clearedGuilds) {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), {
      body: []
    });
  }

  console.log(`Comandos globais registrados: ${commands.map((command) => `/${command.data.name}`).join(', ')}.`);
  if (clearedGuilds.length) {
    console.log(`Comandos antigos de servidor limpos em: ${clearedGuilds.join(', ')}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
