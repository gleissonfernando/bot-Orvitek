require('./lib/loadEnv');

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { getGuildSetup } = require('./lib/store');
const { buildServerRulesEmbeds } = require('./lib/serverRules');
const { replacePanelMessage } = require('./lib/panelUtils');
const { resolveConfiguredChannel } = require('./lib/panelLookup');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const channel = await resolveConfiguredChannel(guild, setup, 'rules');

  if (!channel?.isTextBased()) {
    throw new Error('Canal de regras não encontrado. Execute /ativar primeiro.');
  }

  await replacePanelMessage(channel, { embeds: buildServerRulesEmbeds() });
  console.log(`Regras publicadas em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
