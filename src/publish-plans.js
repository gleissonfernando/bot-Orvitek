require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildPlansEmbeds } = require('./lib/plans');
const { getGuildSetup, getSystemSettings } = require('./lib/store');
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
  const channel = await resolveConfiguredChannel(guild, setup, 'plans');

  if (!channel?.isTextBased()) {
    throw new Error('Canal planos-e-precos não encontrado. Execute /ativar primeiro.');
  }

  const settings = getSystemSettings(guild.id);
  await replacePanelMessage(channel, {
    embeds: buildPlansEmbeds({ settings })
  });
  console.log(`Painel de planos publicado em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
