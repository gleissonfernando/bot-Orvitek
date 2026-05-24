require('dotenv').config();

const { Client, Events, GatewayIntentBits, ChannelType } = require('discord.js');
const { categories } = require('../../src/config/setup');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function findByNames(channels, names, type) {
  return channels.find((channel) => names.includes(channel.name) && channel.type === type);
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const channels = await guild.channels.fetch();
  const renamed = [];

  for (const categorySpec of categories) {
    const category = findByNames(channels, [categorySpec.name, categorySpec.oldName].filter(Boolean), ChannelType.GuildCategory);
    if (category && category.name !== categorySpec.name) {
      await category.setName(categorySpec.name, 'SetupBot adicionando emojis');
      renamed.push(categorySpec.name);
    }

    for (const channelSpec of categorySpec.channels) {
      const channel = findByNames(channels, [channelSpec.name, channelSpec.oldName].filter(Boolean), ChannelType.GuildText);
      if (channel && channel.name !== channelSpec.name) {
        await channel.setName(channelSpec.name, 'SetupBot adicionando emojis');
        renamed.push(channelSpec.name);
      }
    }
  }

  console.log(`Canais/categorias renomeados: ${renamed.length}`);
  for (const name of renamed) {
    console.log(`- ${name}`);
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
