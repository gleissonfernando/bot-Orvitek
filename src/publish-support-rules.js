require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { getGuildSetup } = require('./lib/store');
const { buildSupportRulesEmbeds } = require('./lib/supportRules');
const { replacePanelMessage } = require('./lib/panelUtils');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const channelId = setup?.channels?.supportRules;
  const channel = channelId
    ? await guild.channels.fetch(channelId).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    throw new Error('Canal de regras-suporte não encontrado. Execute /ativar primeiro.');
  }

  await replacePanelMessage(channel, { embeds: buildSupportRulesEmbeds() });
  console.log(`Regras de suporte publicadas em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
