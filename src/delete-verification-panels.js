require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { getGuildSetup } = require('./lib/store');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const channels = await guild.channels.fetch();
  const setup = getGuildSetup(guild.id);
  const channel = channels.get(setup?.channels?.verify) ||
    channels.find((item) => item?.name?.includes('verificar-acesso'));

  if (!channel?.isTextBased()) {
    throw new Error('Canal de verificação não encontrado.');
  }

  let before;
  let scanned = 0;
  let removed = 0;

  while (scanned < 500) {
    const messages = await channel.messages.fetch({ limit: 100, before });
    if (messages.size === 0) break;

    for (const message of messages.values()) {
      const hasVerificationEmbed = message.embeds.some((embed) =>
        String(embed.title || '').includes('Verificação de Acesso')
      );
      const hasVerifyButton = message.components.some((row) =>
        row.components.some((component) => ['setup_verify', 'verify_member'].includes(component.customId || component.data?.custom_id))
      );

      if (message.author.id === client.user.id && (hasVerificationEmbed || hasVerifyButton)) {
        await message.delete().then(() => {
          removed += 1;
        }).catch(() => null);
      }
    }

    scanned += messages.size;
    before = messages.last().id;
  }

  console.log(`Canal verificado: #${channel.name}`);
  console.log(`Mensagens verificadas: ${scanned}`);
  console.log(`Painéis de verificação removidos: ${removed}`);
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
