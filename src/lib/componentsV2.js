const { MessageFlags } = require('discord.js');

const COMPONENTS_V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL_COMPONENTS_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const DEFAULT_COLOR = 0x5865f2;
const TEXT_CHUNK_LIMIT = 3600;
const COMPONENT_TYPE = {
  ActionRow: 1,
  TextDisplay: 10,
  MediaGallery: 12,
  Container: 17
};

function flagsValue(flags = 0) {
  if (typeof flags === 'number') return flags;
  if (typeof flags?.bitfield === 'number') return flags.bitfield;
  if (Array.isArray(flags)) {
    return flags.reduce((value, flag) => value | (MessageFlags[flag] || 0), 0);
  }
  return 0;
}

function hasFlag(flags, flag) {
  return (flagsValue(flags) & flag) === flag;
}

function withFlags(flags, extraFlags) {
  return flagsValue(flags) | extraFlags;
}

function cleanText(value) {
  return String(value || '').trim();
}

function chunkText(text) {
  const chunks = [];
  let remaining = cleanText(text);

  while (remaining.length > TEXT_CHUNK_LIMIT) {
    let index = remaining.lastIndexOf('\n', TEXT_CHUNK_LIMIT);
    if (index < TEXT_CHUNK_LIMIT * 0.5) {
      index = TEXT_CHUNK_LIMIT;
    }
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function componentData(component) {
  if (!component) return null;
  if (typeof component.toJSON === 'function') return component.toJSON();
  if (component.data) return component.data;
  return component;
}

function addText(components, text) {
  for (const chunk of chunkText(text)) {
    components.push({ type: COMPONENT_TYPE.TextDisplay, content: chunk });
  }
}

function mediaItem(url, description) {
  if (!url) return null;
  return {
    media: { url },
    description: description || null
  };
}

function embedData(embed) {
  if (!embed) return null;
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  if (embed.data) return embed.data;
  return embed;
}

function embedToMarkdown(embed) {
  const data = embedData(embed);
  if (!data) return '';

  const lines = [];
  if (data.author?.name) {
    lines.push(`**${data.author.name}**`);
  }

  if (data.title) {
    lines.push(data.url ? `## [${data.title}](${data.url})` : `## ${data.title}`);
  }

  if (data.description) {
    lines.push(data.description);
  }

  for (const field of data.fields || []) {
    lines.push(`**${field.name || 'Info'}**\n${field.value || '-'}`);
  }

  if (data.footer?.text) {
    lines.push(`_${data.footer.text}_`);
  }

  if (data.timestamp) {
    const time = Math.floor(new Date(data.timestamp).getTime() / 1000);
    if (Number.isFinite(time)) {
      lines.push(`<t:${time}:F>`);
    }
  }

  return lines.filter(Boolean).join('\n\n');
}

function embedToMediaItems(embed) {
  const data = embedData(embed);
  if (!data) return [];

  return [
    mediaItem(data.image?.url, data.title || data.description || null),
    mediaItem(data.thumbnail?.url, data.title || data.description || null)
  ].filter(Boolean);
}

function firstEmbedColor(embeds = []) {
  const data = embedData(embeds[0]);
  return typeof data?.color === 'number' ? data.color : DEFAULT_COLOR;
}

function componentType(component) {
  return componentData(component)?.type || null;
}

function isActionRow(component) {
  return componentType(component) === COMPONENT_TYPE.ActionRow;
}

function isComponentsV2Payload(payload) {
  return Boolean(payload && typeof payload === 'object' && hasFlag(payload.flags, COMPONENTS_V2));
}

function textPayload(content, options = {}) {
  const flags = options.ephemeral ? EPHEMERAL_COMPONENTS_V2 : COMPONENTS_V2;
  const container = {
    type: COMPONENT_TYPE.Container,
    accent_color: options.color || DEFAULT_COLOR,
    components: []
  };
  addText(container.components, content || '-');
  return { flags, components: [container] };
}

function buildContainers(components, color) {
  const containers = [];
  let remaining = components.filter(Boolean);

  while (remaining.length) {
    containers.push({
      type: COMPONENT_TYPE.Container,
      accent_color: color || DEFAULT_COLOR,
      components: remaining.slice(0, 10)
    });
    remaining = remaining.slice(10);
  }

  return containers;
}

function toComponentsV2(payload, options = {}) {
  if (payload == null) return payload;
  if (typeof payload === 'string') {
    return textPayload(payload, options);
  }

  if (isComponentsV2Payload(payload)) {
    const extraFlags = options.ephemeral ? MessageFlags.Ephemeral : 0;
    return { ...payload, flags: withFlags(payload.flags, extraFlags) };
  }

  if (typeof payload !== 'object') {
    return textPayload(String(payload), options);
  }

  const content = cleanText(payload.content);
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.filter(Boolean) : [];
  const originalComponents = Array.isArray(payload.components) ? payload.components.filter(Boolean).map(componentData) : [];
  const actionRows = originalComponents.filter(isActionRow);
  const otherComponents = originalComponents.filter((component) => !isActionRow(component));
  const hasConvertedText = Boolean(content || embeds.length);
  const flags = withFlags(payload.flags, COMPONENTS_V2 | (options.ephemeral ? MessageFlags.Ephemeral : 0));
  const next = { ...payload, flags };

  delete next.content;
  delete next.embeds;

  const components = [];
  if (hasConvertedText || actionRows.length) {
    const innerComponents = [];
    const textParts = [];

    if (content) {
      textParts.push(content);
    }

    for (const embed of embeds) {
      const text = embedToMarkdown(embed);
      if (text) textParts.push(text);
    }

    addText(innerComponents, textParts.join('\n\n') || '\u200b');

    const mediaItems = embeds.flatMap(embedToMediaItems);
    for (let index = 0; index < mediaItems.length; index += 10) {
      innerComponents.push({
        type: COMPONENT_TYPE.MediaGallery,
        items: mediaItems.slice(index, index + 10)
      });
    }

    if (actionRows.length) {
      innerComponents.push(...actionRows);
    }

    components.push(...buildContainers(innerComponents, options.color || firstEmbedColor(embeds)));
  }

  components.push(...otherComponents);
  next.components = components.length ? components : originalComponents;
  return next;
}

module.exports = {
  COMPONENTS_V2,
  EPHEMERAL_COMPONENTS_V2,
  isComponentsV2Payload,
  textPayload,
  toComponentsV2
};
