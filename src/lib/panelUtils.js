async function replacePanelMessage(channel, payload) {
  if (!channel?.isTextBased()) {
    return null;
  }

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (messages?.size) {
    for (const message of messages.values()) {
      if (message.author?.id === channel.client.user.id) {
        await message.delete().catch(() => null);
      }
    }
  }

  return channel.send(payload);
}

module.exports = {
  replacePanelMessage
};
