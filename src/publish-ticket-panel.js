require('./lib/loadEnv');

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { getGuildSetup } = require('./lib/store');
const { buildTicketPanelPayload } = require('./lib/staticPanels');
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
  const channelId = setup?.channels?.openTicket;
  if (!channelId) {
    throw new Error('Canal abrir-ticket não encontrado no setup. Execute /ativar primeiro.');
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error('Canal abrir-ticket não é um canal de texto válido.');
  }

  await replacePanelMessage(channel, buildTicketPanelPayload());
  console.log(`Painel de ticket publicado em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
