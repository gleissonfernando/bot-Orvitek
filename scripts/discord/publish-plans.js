require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildPlanSelectionPanelPayload } = require('../../src/lib/planSelectionPanel');
const { getGuildSetup } = require('../../src/lib/store');
const { replacePanelMessage } = require('../../src/lib/panelUtils');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function findChannel(guild, configuredChannelId, names) {
  if (configuredChannelId) {
    const channel = client.channels.cache.get(configuredChannelId) || await guild.channels.fetch(configuredChannelId).catch(() => null);
    if (channel?.isTextBased()) return channel;
  }

  const channels = await guild.channels.fetch();
  return channels.find((channel) =>
    channel?.isTextBased() &&
    names.some((name) => channel.name?.includes(name))
  ) || null;
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const channels = [
    await findChannel(
      guild,
      process.env.CANAL_ID || process.env.PLAN_PANEL_CHANNEL_ID || setup?.channels?.plans,
      ['planos-e-precos', 'planos', 'precos']
    ),
    await findChannel(
      guild,
      process.env.BUY_NOW_CHANNEL_ID || setup?.channels?.buyNow,
      ['comprar-agora']
    )
  ].filter(Boolean);

  if (!channels.length) {
    throw new Error('Canal planos-e-precos não encontrado. Configure CANAL_ID no .env ou execute /ativar primeiro.');
  }

  for (const channel of channels) {
    await replacePanelMessage(channel, buildPlanSelectionPanelPayload(guild.id));
    console.log(`Painel de planos publicado em #${channel.name}.`);
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
