const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { upsertCloneLog } = require('./store');

const API_PAUSE_MS = 350;
const MAX_DISCORD_ROLES = 250;
const MAX_DISCORD_CHANNELS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDiscordId(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

function supportedChannelTypes() {
  return [
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
  ].filter((value) => value !== undefined);
}

async function fetchBotMember(guild) {
  return guild.members.me || await guild.members.fetchMe().catch(() => null);
}

async function requireBotPermission(guild, permissions, label) {
  const member = await fetchBotMember(guild);
  if (!member) {
    throw new Error(`Nao encontrei o bot no servidor ${label}.`);
  }

  const missing = permissions.filter((permission) => permission && !member.permissions.has(permission));
  if (missing.length) {
    throw new Error(`Permissao ausente no servidor ${label}. O bot precisa de Administrador para clonar com seguranca.`);
  }

  return member;
}

async function validateCloneRequest({ sourceGuild, targetGuild }) {
  if (!sourceGuild || !targetGuild) {
    throw new Error('Servidor de origem ou destino nao encontrado.');
  }

  if (!isDiscordId(sourceGuild.id) || !isDiscordId(targetGuild.id)) {
    throw new Error('ID de servidor invalido.');
  }

  if (sourceGuild.id === targetGuild.id) {
    throw new Error('O servidor de origem e o destino precisam ser diferentes.');
  }

  await requireBotPermission(sourceGuild, [PermissionFlagsBits.Administrator], 'de origem');
  await requireBotPermission(targetGuild, [PermissionFlagsBits.Administrator], 'de destino');
}

async function fetchCloneState(sourceGuild, targetGuild) {
  await sourceGuild.roles.fetch().catch(() => null);
  await targetGuild.roles.fetch().catch(() => null);
  await sourceGuild.channels.fetch().catch(() => null);
  await targetGuild.channels.fetch().catch(() => null);
  await sourceGuild.emojis.fetch().catch(() => null);
  await targetGuild.emojis.fetch().catch(() => null);

  const sourceRoles = sourceGuild.roles.cache
    .filter((role) => role.id !== sourceGuild.roles.everyone.id && !role.managed)
    .sort((a, b) => a.position - b.position);
  const sourceChannels = sourceGuild.channels.cache
    .filter((channel) => supportedChannelTypes().includes(channel.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const sourceEmojis = sourceGuild.emojis.cache;

  const rolesToCreate = sourceRoles.filter((role) =>
    !targetGuild.roles.cache.some((targetRole) => targetRole.name === role.name && !targetRole.managed)
  );
  const channelsToCreate = sourceChannels.filter((channel) =>
    !targetGuild.channels.cache.some((targetChannel) => targetChannel.name === channel.name && targetChannel.type === channel.type)
  );

  if (targetGuild.roles.cache.size + rolesToCreate.size > MAX_DISCORD_ROLES) {
    throw new Error(`O destino excederia o limite de ${MAX_DISCORD_ROLES} cargos do Discord.`);
  }

  if (targetGuild.channels.cache.size + channelsToCreate.size > MAX_DISCORD_CHANNELS) {
    throw new Error(`O destino excederia o limite de ${MAX_DISCORD_CHANNELS} canais do Discord.`);
  }

  return {
    sourceRoles,
    sourceChannels,
    sourceEmojis,
    total:
      sourceRoles.size +
      sourceEmojis.size +
      sourceChannels.size +
      1
  };
}

function createReport({ sourceGuild, targetGuild, userId }) {
  return {
    id: crypto.randomUUID(),
    status: 'running',
    sourceGuildId: sourceGuild.id,
    sourceGuildName: sourceGuild.name,
    targetGuildId: targetGuild.id,
    targetGuildName: targetGuild.name,
    requestedBy: userId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    current: 0,
    total: 0,
    created: {
      roles: 0,
      emojis: 0,
      categories: 0,
      textChannels: 0,
      voiceChannels: 0,
      announcementChannels: 0,
      forumChannels: 0,
      visualSettings: 0
    },
    skipped: {
      roles: 0,
      emojis: 0,
      channels: 0,
      memberOverwrites: 0
    },
    warnings: [],
    errors: [],
    stages: []
  };
}

function summarizeReport(report) {
  return {
    ...report,
    warnings: report.warnings.slice(-25),
    errors: report.errors.slice(-25),
    stages: report.stages.slice(-50)
  };
}

async function saveReport(report, status = report.status) {
  report.status = status;
  upsertCloneLog(report.id, summarizeReport(report));
}

async function progress(report, onProgress, stage, message) {
  report.stages.push({ stage, message, at: new Date().toISOString() });
  await saveReport(report);
  if (onProgress) {
    await onProgress({ stage, message, report });
  }
}

function pushWarning(report, message) {
  report.warnings.push(message);
}

function pushError(report, message) {
  report.errors.push(message);
}

function createRoleIdMap(sourceGuild, targetGuild) {
  return {
    [sourceGuild.roles.everyone.id]: targetGuild.roles.everyone.id
  };
}

async function cloneRoles(sourceGuild, targetGuild, sourceRoles, roleIdMap, report, onProgress) {
  await requireBotPermission(targetGuild, [PermissionFlagsBits.ManageRoles], 'de destino');

  for (const sourceRole of sourceRoles.values()) {
    report.current += 1;
    await progress(report, onProgress, 'roles', `Copiando cargo ${sourceRole.name}`);

    const existing = targetGuild.roles.cache.find((role) => role.name === sourceRole.name && !role.managed);
    if (existing) {
      roleIdMap[sourceRole.id] = existing.id;
      report.skipped.roles += 1;
      continue;
    }

    try {
      const role = await targetGuild.roles.create({
        name: sourceRole.name,
        color: sourceRole.color,
        hoist: sourceRole.hoist,
        mentionable: sourceRole.mentionable,
        permissions: sourceRole.permissions.bitfield,
        reason: `Clonagem /ativar de ${sourceGuild.name}`
      });

      roleIdMap[sourceRole.id] = role.id;
      report.created.roles += 1;

      await role.setPosition(sourceRole.position, `Clonagem /ativar de ${sourceGuild.name}`).catch((error) => {
        pushWarning(report, `Nao consegui posicionar o cargo ${role.name}: ${error.message}`);
      });
    } catch (error) {
      pushError(report, `Cargo ${sourceRole.name}: ${error.message}`);
    }

    await sleep(API_PAUSE_MS);
  }
}

async function cloneEmojis(sourceGuild, targetGuild, sourceEmojis, emojiIdMap, report, onProgress) {
  const expressionPermission = PermissionFlagsBits.ManageGuildExpressions || PermissionFlagsBits.ManageEmojisAndStickers;
  if (expressionPermission) {
    await requireBotPermission(targetGuild, [expressionPermission], 'de destino');
  }

  for (const sourceEmoji of sourceEmojis.values()) {
    report.current += 1;
    await progress(report, onProgress, 'emojis', `Copiando emoji ${sourceEmoji.name}`);

    const existing = targetGuild.emojis.cache.find((emoji) => emoji.name === sourceEmoji.name);
    if (existing) {
      emojiIdMap[sourceEmoji.id] = existing.id;
      report.skipped.emojis += 1;
      continue;
    }

    try {
      const emoji = await targetGuild.emojis.create({
        attachment: sourceEmoji.url,
        name: sourceEmoji.name,
        reason: `Clonagem /ativar de ${sourceGuild.name}`
      });
      emojiIdMap[sourceEmoji.id] = emoji.id;
      report.created.emojis += 1;
    } catch (error) {
      pushWarning(report, `Emoji ${sourceEmoji.name} nao foi copiado: ${error.message}`);
    }

    await sleep(API_PAUSE_MS);
  }
}

function cloneOverwrite(sourceGuild, targetGuild, overwrite, roleIdMap, report) {
  const mappedRoleId = roleIdMap[overwrite.id];
  if (!mappedRoleId) {
    report.skipped.memberOverwrites += 1;
    return null;
  }

  return {
    id: mappedRoleId === sourceGuild.roles.everyone.id ? targetGuild.roles.everyone.id : mappedRoleId,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield
  };
}

function clonePermissionOverwrites(sourceGuild, targetGuild, sourceChannel, roleIdMap, report) {
  return sourceChannel.permissionOverwrites.cache
    .map((overwrite) => cloneOverwrite(sourceGuild, targetGuild, overwrite, roleIdMap, report))
    .filter(Boolean);
}

function cloneForumEmoji(sourceEmoji, emojiIdMap) {
  if (!sourceEmoji) return undefined;
  const emojiId = sourceEmoji.id || sourceEmoji.emojiId;
  const emojiName = sourceEmoji.name || sourceEmoji.emojiName;
  if (emojiId && emojiIdMap[emojiId]) {
    return { id: emojiIdMap[emojiId], name: emojiName || null };
  }
  if (!emojiId && emojiName) {
    return { name: emojiName };
  }
  return undefined;
}

function cloneForumTags(sourceChannel, emojiIdMap) {
  return (sourceChannel.availableTags || []).map((tag) => {
    const next = {
      name: tag.name,
      moderated: Boolean(tag.moderated)
    };
    const emoji = cloneForumEmoji(tag.emoji, emojiIdMap);
    if (emoji) next.emoji = emoji;
    return next;
  });
}

function baseChannelPayload(sourceGuild, targetGuild, sourceChannel, roleIdMap, categoryIdMap, report) {
  return {
    name: sourceChannel.name,
    type: sourceChannel.type,
    parent: sourceChannel.parentId ? categoryIdMap[sourceChannel.parentId] || null : null,
    permissionOverwrites: clonePermissionOverwrites(sourceGuild, targetGuild, sourceChannel, roleIdMap, report),
    reason: `Clonagem /ativar de ${sourceGuild.name}`
  };
}

function enrichChannelPayload(payload, sourceChannel, emojiIdMap) {
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(sourceChannel.type)) {
    payload.topic = sourceChannel.topic || undefined;
    payload.nsfw = Boolean(sourceChannel.nsfw);
    payload.rateLimitPerUser = sourceChannel.rateLimitPerUser || 0;
    payload.defaultAutoArchiveDuration = sourceChannel.defaultAutoArchiveDuration || undefined;
  }

  if (sourceChannel.type === ChannelType.GuildVoice) {
    payload.bitrate = sourceChannel.bitrate;
    payload.userLimit = sourceChannel.userLimit;
    payload.rtcRegion = sourceChannel.rtcRegion || undefined;
  }

  if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(sourceChannel.type)) {
    payload.topic = sourceChannel.topic || undefined;
    payload.nsfw = Boolean(sourceChannel.nsfw);
    payload.rateLimitPerUser = sourceChannel.rateLimitPerUser || 0;
    payload.defaultAutoArchiveDuration = sourceChannel.defaultAutoArchiveDuration || undefined;
    payload.defaultThreadRateLimitPerUser = sourceChannel.defaultThreadRateLimitPerUser || 0;
    payload.defaultSortOrder = sourceChannel.defaultSortOrder ?? undefined;
    payload.defaultForumLayout = sourceChannel.defaultForumLayout ?? undefined;
    payload.availableTags = cloneForumTags(sourceChannel, emojiIdMap);
    payload.defaultReactionEmoji = cloneForumEmoji(sourceChannel.defaultReactionEmoji, emojiIdMap);
  }

  return payload;
}

function findExistingCategory(targetGuild, sourceCategory) {
  return targetGuild.channels.cache.find((channel) =>
    channel.name === sourceCategory.name && channel.type === ChannelType.GuildCategory
  );
}

function findExistingChannel(targetGuild, sourceChannel, targetParentId) {
  return targetGuild.channels.cache.find((channel) =>
    channel.name === sourceChannel.name &&
    channel.type === sourceChannel.type &&
    (targetParentId ? channel.parentId === targetParentId : true)
  );
}

function channelCounterKey(type) {
  if (type === ChannelType.GuildCategory) return 'categories';
  if (type === ChannelType.GuildVoice) return 'voiceChannels';
  if (type === ChannelType.GuildAnnouncement) return 'announcementChannels';
  if (type === ChannelType.GuildForum || type === ChannelType.GuildMedia) return 'forumChannels';
  return 'textChannels';
}

async function cloneCategories(sourceGuild, targetGuild, categories, roleIdMap, categoryIdMap, report, onProgress) {
  await requireBotPermission(targetGuild, [PermissionFlagsBits.ManageChannels], 'de destino');

  for (const sourceCategory of categories.values()) {
    report.current += 1;
    await progress(report, onProgress, 'categorias', `Copiando categoria ${sourceCategory.name}`);

    const existing = findExistingCategory(targetGuild, sourceCategory);
    if (existing) {
      categoryIdMap[sourceCategory.id] = existing.id;
      report.skipped.channels += 1;
      continue;
    }

    try {
      const category = await targetGuild.channels.create({
        name: sourceCategory.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: clonePermissionOverwrites(sourceGuild, targetGuild, sourceCategory, roleIdMap, report),
        reason: `Clonagem /ativar de ${sourceGuild.name}`
      });
      categoryIdMap[sourceCategory.id] = category.id;
      report.created.categories += 1;
      await category.setPosition(sourceCategory.rawPosition).catch((error) => {
        pushWarning(report, `Nao consegui posicionar a categoria ${category.name}: ${error.message}`);
      });
    } catch (error) {
      pushError(report, `Categoria ${sourceCategory.name}: ${error.message}`);
    }

    await sleep(API_PAUSE_MS);
  }
}

async function cloneChannels(sourceGuild, targetGuild, channels, roleIdMap, emojiIdMap, categoryIdMap, report, onProgress) {
  await requireBotPermission(targetGuild, [PermissionFlagsBits.ManageChannels], 'de destino');

  for (const sourceChannel of channels.values()) {
    report.current += 1;
    await progress(report, onProgress, 'canais', `Copiando canal ${sourceChannel.name}`);

    const targetParentId = sourceChannel.parentId ? categoryIdMap[sourceChannel.parentId] || null : null;
    const existing = findExistingChannel(targetGuild, sourceChannel, targetParentId);
    if (existing) {
      report.skipped.channels += 1;
      continue;
    }

    try {
      const payload = enrichChannelPayload(
        baseChannelPayload(sourceGuild, targetGuild, sourceChannel, roleIdMap, categoryIdMap, report),
        sourceChannel,
        emojiIdMap
      );
      const channel = await targetGuild.channels.create(payload);
      report.created[channelCounterKey(sourceChannel.type)] += 1;
      await channel.setPosition(sourceChannel.rawPosition).catch((error) => {
        pushWarning(report, `Nao consegui posicionar o canal ${channel.name}: ${error.message}`);
      });
    } catch (error) {
      pushError(report, `Canal ${sourceChannel.name}: ${error.message}`);
    }

    await sleep(API_PAUSE_MS);
  }
}

async function fetchAssetBuffer(url) {
  if (!url || typeof fetch !== 'function') return null;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function cloneVisualSettings(sourceGuild, targetGuild, report, onProgress) {
  await requireBotPermission(targetGuild, [PermissionFlagsBits.ManageGuild], 'de destino');

  report.current += 1;
  await progress(report, onProgress, 'visual', `Copiando visual de ${sourceGuild.name}`);

  try {
    if (targetGuild.name !== sourceGuild.name) {
      await targetGuild.setName(sourceGuild.name, `Clonagem /ativar de ${sourceGuild.name}`);
      report.created.visualSettings += 1;
    }
  } catch (error) {
    pushWarning(report, `Nome do servidor nao foi copiado: ${error.message}`);
  }

  const visualTasks = [
    {
      label: 'icone',
      url: sourceGuild.iconURL({ extension: 'png', size: 1024 }),
      apply: (buffer) => targetGuild.setIcon(buffer, `Clonagem /ativar de ${sourceGuild.name}`)
    },
    {
      label: 'banner',
      url: sourceGuild.bannerURL({ extension: 'png', size: 1024 }),
      apply: (buffer) => targetGuild.setBanner(buffer, `Clonagem /ativar de ${sourceGuild.name}`)
    },
    {
      label: 'splash',
      url: sourceGuild.splashURL({ extension: 'png', size: 1024 }),
      apply: (buffer) => targetGuild.setSplash(buffer, `Clonagem /ativar de ${sourceGuild.name}`)
    }
  ];

  for (const task of visualTasks) {
    if (!task.url) continue;
    try {
      const buffer = await fetchAssetBuffer(task.url);
      if (!buffer) continue;
      await task.apply(buffer);
      report.created.visualSettings += 1;
      await sleep(API_PAUSE_MS);
    } catch (error) {
      pushWarning(report, `Visual ${task.label} nao foi copiado: ${error.message}`);
    }
  }
}

async function runServerClone({ sourceGuild, targetGuild, userId, onProgress }) {
  await validateCloneRequest({ sourceGuild, targetGuild, userId });

  const report = createReport({ sourceGuild, targetGuild, userId });
  await saveReport(report, 'running');

  try {
    const state = await fetchCloneState(sourceGuild, targetGuild);
    report.total = state.total;
    await progress(report, onProgress, 'preparacao', 'Validacoes concluidas. Iniciando clonagem.');

    const roleIdMap = createRoleIdMap(sourceGuild, targetGuild);
    const emojiIdMap = {};
    const categoryIdMap = {};
    const categories = state.sourceChannels.filter((channel) => channel.type === ChannelType.GuildCategory);
    const channels = state.sourceChannels.filter((channel) => channel.type !== ChannelType.GuildCategory);

    await cloneRoles(sourceGuild, targetGuild, state.sourceRoles, roleIdMap, report, onProgress);
    await cloneEmojis(sourceGuild, targetGuild, state.sourceEmojis, emojiIdMap, report, onProgress);
    await cloneCategories(sourceGuild, targetGuild, categories, roleIdMap, categoryIdMap, report, onProgress);
    await cloneChannels(sourceGuild, targetGuild, channels, roleIdMap, emojiIdMap, categoryIdMap, report, onProgress);
    await cloneVisualSettings(sourceGuild, targetGuild, report, onProgress);

    report.status = report.errors.length ? 'completed_with_errors' : 'completed';
    report.finishedAt = new Date().toISOString();
    await progress(report, onProgress, 'finalizado', 'Clonagem finalizada.');
    await saveReport(report, report.status);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    pushError(report, error.message);
    await saveReport(report, 'failed');
    throw error;
  }
}

module.exports = {
  isDiscordId,
  runServerClone,
  validateCloneRequest
};
