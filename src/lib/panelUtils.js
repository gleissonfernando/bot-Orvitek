const { suppressPanelRestore } = require('./panelRestore');

async function replacePanelMessage(channel, payload) {
  if (!channel?.isTextBased()) {
    return null;
  }

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (messages?.size) {
    let suppressionEnabled = false;
    for (const message of messages.values()) {
      if (message.author?.id === channel.client.user.id) {
        if (!suppressionEnabled) {
          suppressPanelRestore(channel.id, 10000);
          suppressionEnabled = true;
        }
        await message.delete().catch(() => null);
      }
    }
  }

  return channel.send(payload);
}

module.exports = {
  replacePanelMessage
};
