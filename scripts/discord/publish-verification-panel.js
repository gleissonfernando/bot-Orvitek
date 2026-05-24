require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { buildVerificationPanel } = require('../../src/lib/verificationPanel');
const { getGuildSetup } = require('../../src/lib/store');
const { replacePanelMessage } = require('../../src/lib/panelUtils');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const setup = getGuildSetup(guild.id);
  const channelId = setup?.channels?.verify;
  const channel = channelId
    ? await guild.channels.fetch(channelId).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    throw new Error('Canal de verificação não encontrado. Execute /ativar primeiro.');
  }

  await replacePanelMessage(channel, buildVerificationPanel());

  console.log(`Painel de verificação publicado em #${channel.name}.`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
