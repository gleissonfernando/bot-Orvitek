require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildPlanSelectionPanelPayload } = require('./lib/planSelectionPanel');
const { getGuildSetup } = require('./lib/store');
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
  const CANAL_ID = process.env.CANAL_ID || process.env.PLAN_PANEL_CHANNEL_ID || setup?.channels?.plans;
  const channel = CANAL_ID
    ? client.channels.cache.get(CANAL_ID) || await guild.channels.fetch(CANAL_ID).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    throw new Error('Canal planos-e-precos não encontrado. Execute /ativar primeiro.');
  }

  await replacePanelMessage(channel, buildPlanSelectionPanelPayload());
  console.log(`Painel de planos publicado em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
