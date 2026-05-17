require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { getGuildSetup } = require('./lib/store');
const { buildHowItWorksEmbeds } = require('./lib/howItWorks');
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
  const channel = await resolveConfiguredChannel(guild, setup, 'howItWorks');

  if (!channel?.isTextBased()) {
    throw new Error('Canal como-funciona não encontrado. Execute /ativar primeiro.');
  }

  await replacePanelMessage(channel, { embeds: buildHowItWorksEmbeds() });
  console.log(`Como funciona publicado em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
