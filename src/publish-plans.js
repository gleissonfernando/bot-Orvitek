require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildLifetimePlanPanelPayload, buildMonthlyPlanPanelPayload } = require('./lib/planSelectionPanel');
const { getGuildSetup } = require('./lib/store');
const { replacePanelMessage } = require('./lib/panelUtils');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function publishPanel(guild, channelId, payload, label) {
  const channel = channelId
    ? client.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)
    : null;

  if (!channel?.isTextBased()) return false;

  await replacePanelMessage(channel, payload);
  console.log(`${label} publicado em #${channel.name}.`);
  return true;
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const published = [];

  published.push(await publishPanel(
    guild,
    process.env.MONTHLY_PLAN_CHANNEL_ID || process.env.PLAN_PANEL_CHANNEL_ID || process.env.CANAL_ID || setup?.channels?.plans,
    buildMonthlyPlanPanelPayload(guild.id),
    'Painel mensal'
  ));

  published.push(await publishPanel(
    guild,
    process.env.LIFETIME_PLAN_CHANNEL_ID || process.env.BUY_NOW_CHANNEL_ID || setup?.channels?.buyNow,
    buildLifetimePlanPanelPayload(guild.id),
    'Painel vitalicio'
  ));

  if (!published.some(Boolean)) {
    throw new Error('Nenhum canal de painel encontrado. Execute /ativar primeiro ou configure MONTHLY_PLAN_CHANNEL_ID/LIFETIME_PLAN_CHANNEL_ID.');
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
