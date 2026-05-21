const { toComponentsV2 } = require('./componentsV2');

const PANEL_TITLES = [
  'Contrato Online',
  'Painel de controle do sistema',
  'Planos para Bot Discord Profissional',
  'Plano Básico',
  'Plano Premium',
  'Hospedagem e entrega',
  'Promoção ativada',
  'Promoção desativada'
];

function payloadTitles(payload) {
  return (payload?.embeds || [])
    .map((embed) => embed?.data?.title || embed?.title)
    .filter(Boolean);
}

function looksLikePanelMessage(message, titles = []) {
  const messageTitles = message.embeds?.map((embed) => embed?.title).filter(Boolean) || [];
  const sameTitle = titles.length && messageTitles.some((title) => titles.includes(title));
  const knownPanel = messageTitles.some((title) => PANEL_TITLES.some((panelTitle) => title.startsWith(panelTitle)));
  const hasComponents = message.components?.length > 0;
  return sameTitle || knownPanel || hasComponents;
}

async function deleteMessages(messages) {
  if (!messages?.size) return;

  const bulkDeletable = messages.filter((message) => message.bulkDeletable);
  if (bulkDeletable.size) {
    await messages.first()?.channel?.bulkDelete(bulkDeletable, true).catch(async () => {
      for (const message of bulkDeletable.values()) {
        await message.delete().catch(() => null);
      }
    });
  }

  const remaining = messages.filter((message) => !bulkDeletable.has(message.id));
  for (const message of remaining.values()) {
    await message.delete().catch(() => null);
  }
}

async function replacePanelMessage(channel, payload, options = {}) {
  if (!channel?.isTextBased()) {
    return null;
  }

  const titles = payloadTitles(payload);
  const deleteAll = Boolean(options.deleteAll);
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (messages?.size) {
    const removable = messages.filter((message) =>
      deleteAll ||
      message.author?.id === channel.client.user.id ||
      looksLikePanelMessage(message, titles)
    );
    await deleteMessages(removable);
  }

  return channel.send(toComponentsV2(payload));
}

module.exports = {
  replacePanelMessage
};
