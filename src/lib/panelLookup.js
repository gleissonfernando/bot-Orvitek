const { ChannelType } = require('discord.js');
const { categories } = require('../config/setup');

function getChannelSpec(channelKey) {
  for (const category of categories) {
    for (const channel of category.channels) {
      if (channel.key === channelKey) {
        return channel;
      }
    }
  }

  return null;
}

async function resolveConfiguredChannel(guild, setup, channelKey) {
  const channelId = setup?.channels?.[channelKey];
  if (channelId) {
    return guild.channels.fetch(channelId).catch(() => null);
  }

  const spec = getChannelSpec(channelKey);
  if (!spec) {
    return null;
  }

  await guild.channels.fetch().catch(() => null);
  const names = [spec.name, spec.oldName].filter(Boolean);

  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && names.includes(channel.name)
  ) || null;
}

module.exports = {
  resolveConfiguredChannel
};
