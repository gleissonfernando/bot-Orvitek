require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildLifetimePlanPanelPayload, buildMonthlyPlanPanelPayload } = require('../../src/lib/planSelectionPanel');
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

async function findConfiguredChannel(guild, configuredChannelId, names) {
  if (!configuredChannelId) return null;
  return findChannel(guild, configuredChannelId, names);
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const channels = [
    {
      channel: await findConfiguredChannel(
        guild,
        process.env.MONTHLY_PLAN_CHANNEL_ID || setup?.channels?.plans,
        ['plano-mensal', 'mensal']
      ),
      payload: buildMonthlyPlanPanelPayload(guild.id),
      label: 'Painel mensal'
    },
    {
      channel: await findConfiguredChannel(
        guild,
        process.env.LIFETIME_PLAN_CHANNEL_ID || setup?.channels?.buyNow,
        ['plano-vitalicio', 'vitalicio']
      ),
      payload: buildLifetimePlanPanelPayload(guild.id),
      label: 'Painel vitalicio'
    }
  ].filter(Boolean);

  const targets = channels.filter((entry) => entry.channel);

  if (!targets.length) {
    throw new Error('Nenhum canal de painel encontrado. Execute /ativar primeiro ou configure MONTHLY_PLAN_CHANNEL_ID/LIFETIME_PLAN_CHANNEL_ID.');
  }

  for (const target of targets) {
    await replacePanelMessage(target.channel, target.payload);
    console.log(`${target.label} publicado em #${target.channel.name}.`);
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
