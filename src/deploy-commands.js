require('./lib/loadEnv');

const { REST, Routes } = require('discord.js');
const commands = require('./commands/setupCommands');

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(`Variaveis ausentes no .env: ${missingEnv.join(', ')}`);
}

const body = commands.map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: []
  });

  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
    body
  });

  console.log(`Comandos globais limpos. Comandos do servidor registrados: ${commands.map((command) => `/${command.data.name}`).join(', ')}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
