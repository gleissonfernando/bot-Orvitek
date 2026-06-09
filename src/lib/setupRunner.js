const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { categories, colors, roleSpecs, staffRoleKeys } = require('../config/setup');
const { getSystemSettings, saveGuildSetup } = require('./store');
const { buildSupportRulesEmbeds } = require('./supportRules');
const { buildServerRulesEmbeds } = require('./serverRules');
const { buildHowItWorksEmbeds } = require('./howItWorks');
const { buildPromotionEmbed } = require('./plans');
const { buildLifetimePlanPanelPayload, buildMonthlyPlanPanelPayload } = require('./planSelectionPanel');
const { replacePanelMessage } = require('./panelUtils');
const {
  buildRenewPanelPayload,
  buildSuggestionsPanelPayload,
  buildTicketPanelPayload,
  buildVipPromotionPanelPayload
} = require('./staticPanels');
const { toComponentsV2 } = require('./componentsV2');

function rolePermissions(roleIds, roleKeys, allowSend = true) {
  return roleKeys
    .filter((key) => roleIds[key])
    .map((key) => ({
      id: roleIds[key],
      allow: allowSend
        ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
    }));
}

function channelOverwrites(guild, roleIds, spec) {
  const overwrites = [];

  if (spec.denyEveryone) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    });
  } else if (spec.everyone) {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: spec.readOnly ? [PermissionFlagsBits.SendMessages] : []
    });
  }

  if (spec.roleKeys) {
    overwrites.push(...rolePermissions(roleIds, spec.roleKeys, !spec.readOnly));
  }

  for (const key of staffRoleKeys) {
    if (roleIds[key]) {
      overwrites.push({
        id: roleIds[key],
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }
  }

  return overwrites;
}

async function getOrCreateRole(guild, spec, report) {
  const existing = guild.roles.cache.find((role) => role.name === spec.name);
  if (existing) {
    report.skipped.roles.push(spec.name);
    return existing;
  }

  const role = await guild.roles.create({
    name: spec.name,
    color: spec.color,
    permissions: spec.permissions,
    reason: 'SetupBot /ativar'
  });
  report.created.roles.push(role.name);
  return role;
}

async function getOrCreateCategory(guild, spec, report) {
  const names = [spec.name, spec.oldName].filter(Boolean);
  const existing = guild.channels.cache.find((channel) => names.includes(channel.name) && channel.type === ChannelType.GuildCategory);
  if (existing) {
    if (existing.name !== spec.name) {
      await existing.setName(spec.name, 'SetupBot adicionando emojis');
    }
    report.skipped.categories.push(spec.name);
    return existing;
  }

  const category = await guild.channels.create({
    name: spec.name,
    type: ChannelType.GuildCategory,
    reason: 'SetupBot /ativar'
  });
  report.created.categories.push(spec.name);
  return category;
}

async function getOrCreateChannel(guild, category, roleIds, spec, report) {
  const names = [spec.name, spec.oldName].filter(Boolean);
  const existing = guild.channels.cache.find((channel) => names.includes(channel.name) && channel.type === ChannelType.GuildText);
  if (existing) {
    if (existing.name !== spec.name) {
      await existing.setName(spec.name, 'SetupBot adicionando emojis');
    }
    report.skipped.channels.push(spec.name);
    return existing;
  }

  const channel = await guild.channels.create({
    name: spec.name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: channelOverwrites(guild, roleIds, spec),
    reason: 'SetupBot /ativar'
  });
  report.created.channels.push(channel.name);
  return channel;
}

async function copySourceRoles(sourceGuild, targetGuild, report) {
  await sourceGuild.roles.fetch().catch(() => null);
  await targetGuild.roles.fetch().catch(() => null);

  const roleIdMap = {
    [sourceGuild.roles.everyone.id]: targetGuild.roles.everyone.id
  };
  const sourceRoles = sourceGuild.roles.cache
    .filter((role) => role.id !== sourceGuild.roles.everyone.id && !role.managed)
    .sort((a, b) => a.position - b.position);

  for (const sourceRole of sourceRoles.values()) {
    const existing = targetGuild.roles.cache.find((role) => role.name === sourceRole.name && !role.managed);
    if (existing) {
      roleIdMap[sourceRole.id] = existing.id;
      report.skipped.roles.push(sourceRole.name);
      continue;
    }

    const role = await targetGuild.roles.create({
      name: sourceRole.name,
      color: sourceRole.color,
      hoist: sourceRole.hoist,
      mentionable: sourceRole.mentionable,
      permissions: sourceRole.permissions.bitfield,
      reason: `SetupBot /ativar copiando ${sourceGuild.name}`
    });
    roleIdMap[sourceRole.id] = role.id;
    report.created.roles.push(role.name);
  }

  return roleIdMap;
}

function clonePermissionOverwrites(sourceGuild, targetGuild, sourceChannel, roleIdMap) {
  return sourceChannel.permissionOverwrites.cache
    .map((overwrite) => {
      const targetRoleId = roleIdMap[overwrite.id];
      if (!targetRoleId) {
        return null;
      }

      return {
        id: targetRoleId === sourceGuild.roles.everyone.id ? targetGuild.roles.everyone.id : targetRoleId,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield
      };
    })
    .filter(Boolean);
}

async function copySourceChannels(sourceGuild, targetGuild, roleIdMap, report) {
  await sourceGuild.channels.fetch().catch(() => null);
  await targetGuild.channels.fetch().catch(() => null);

  const categoryIdMap = {};
  const sourceCategories = sourceGuild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const sourceCategory of sourceCategories.values()) {
    const existing = targetGuild.channels.cache.find((channel) => channel.name === sourceCategory.name && channel.type === ChannelType.GuildCategory);
    if (existing) {
      categoryIdMap[sourceCategory.id] = existing.id;
      report.skipped.categories.push(sourceCategory.name);
      continue;
    }

    const category = await targetGuild.channels.create({
      name: sourceCategory.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: clonePermissionOverwrites(sourceGuild, targetGuild, sourceCategory, roleIdMap),
      reason: `SetupBot /ativar copiando ${sourceGuild.name}`
    });
    categoryIdMap[sourceCategory.id] = category.id;
    report.created.categories.push(category.name);
  }

  const supportedTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice
  ]);
  const sourceChannels = sourceGuild.channels.cache
    .filter((channel) => supportedTypes.has(channel.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const sourceChannel of sourceChannels.values()) {
    const existing = targetGuild.channels.cache.find((channel) => channel.name === sourceChannel.name && channel.type === sourceChannel.type);
    if (existing) {
      report.skipped.channels.push(sourceChannel.name);
      continue;
    }

    const payload = {
      name: sourceChannel.name,
      type: sourceChannel.type,
      parent: sourceChannel.parentId ? categoryIdMap[sourceChannel.parentId] || null : null,
      permissionOverwrites: clonePermissionOverwrites(sourceGuild, targetGuild, sourceChannel, roleIdMap),
      reason: `SetupBot /ativar copiando ${sourceGuild.name}`
    };

    if (sourceChannel.type === ChannelType.GuildText || sourceChannel.type === ChannelType.GuildAnnouncement) {
      payload.topic = sourceChannel.topic || undefined;
      payload.nsfw = sourceChannel.nsfw || false;
      payload.rateLimitPerUser = sourceChannel.rateLimitPerUser || 0;
    }

    if (sourceChannel.type === ChannelType.GuildVoice) {
      payload.bitrate = sourceChannel.bitrate;
      payload.userLimit = sourceChannel.userLimit;
    }

    const channel = await targetGuild.channels.create(payload);
    report.created.channels.push(channel.name);
  }
}

async function copySourceStructure(sourceGuild, targetGuild, report) {
  if (!sourceGuild || !targetGuild || sourceGuild.id === targetGuild.id) {
    return;
  }

  const roleIdMap = await copySourceRoles(sourceGuild, targetGuild, report);
  await copySourceChannels(sourceGuild, targetGuild, roleIdMap, report);
}

async function assignOwnerRole(guild, ownerRole, ownerDiscordId, report) {
  if (!ownerDiscordId || !ownerRole) {
    return 'nao configurado';
  }

  const member = await guild.members.fetch(ownerDiscordId).catch(() => null);
  if (!member) {
    report.errors.push(`Dono/responsavel nao encontrado no servidor: ${ownerDiscordId}`);
    return 'membro nao encontrado';
  }

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    report.errors.push('Nao consegui aplicar o cargo Dono: permissao Gerenciar cargos ausente.');
    return 'sem permissao';
  }

  if (!ownerRole.editable) {
    report.errors.push('Nao consegui aplicar o cargo Dono: hierarquia do cargo do bot bloqueia a acao.');
    return 'hierarquia bloqueada';
  }

  if (member.roles.cache.has(ownerRole.id)) {
    return 'ja possuia';
  }

  await member.roles.add(ownerRole, 'SetupBot /ativar - dono configurado');
  report.assigned.roles.push(ownerRole.name);
  return 'aplicado';
}

async function sendPanels(guildId, channels, report) {
  const settings = getSystemSettings(guildId);

  if (channels.rules?.isTextBased()) {
    await replacePanelMessage(channels.rules, { embeds: buildServerRulesEmbeds() });
  }

  if (channels.howItWorks?.isTextBased()) {
    await replacePanelMessage(channels.howItWorks, { embeds: buildHowItWorksEmbeds() });
  }

  if (channels.supportRules?.isTextBased()) {
    await replacePanelMessage(channels.supportRules, { embeds: buildSupportRulesEmbeds() });
  }

  if (channels.plans?.isTextBased()) {
    await replacePanelMessage(channels.plans, buildMonthlyPlanPanelPayload(guildId));
  }

  if (channels.buyNow?.isTextBased()) {
    await replacePanelMessage(channels.buyNow, buildLifetimePlanPanelPayload(guildId));
    report.created.panels.push('Compra');
  }

  if (channels.promotions?.isTextBased()) {
    await replacePanelMessage(channels.promotions, { embeds: [buildPromotionEmbed(settings.retail.active)] });
    report.created.panels.push('Promoções');
  }

  if (channels.vipOnly?.isTextBased()) {
    await replacePanelMessage(channels.vipOnly, buildVipPromotionPanelPayload(settings));
    report.created.panels.push('VIP');
  }

  await replacePanelMessage(channels.openTicket, buildTicketPanelPayload());
  report.created.panels.push('Suporte');

  await replacePanelMessage(channels.renewPlan, buildRenewPanelPayload());
  report.created.panels.push('Renovação');

  await replacePanelMessage(channels.suggestions, buildSuggestionsPanelPayload());
  report.created.panels.push('Sugestões');
}

async function runSetup(interaction, options = {}) {
  const guild = options.targetGuild || interaction.guild;
  const sourceGuild = options.sourceGuild || interaction.guild;
  const ownerDiscordId = String(options.ownerDiscordId || '').trim() || interaction.user.id;
  const report = {
    created: { roles: [], categories: [], channels: [], panels: [] },
    assigned: { roles: [] },
    skipped: { roles: [], categories: [], channels: [] },
    errors: []
  };

  await copySourceStructure(sourceGuild, guild, report);

  const roles = {};
  for (const spec of roleSpecs) {
    const role = await getOrCreateRole(guild, spec, report);
    roles[spec.key] = role;
  }

  const ownerAssignment = await assignOwnerRole(guild, roles.owner, ownerDiscordId, report);
  const roleIds = Object.fromEntries(Object.entries(roles).map(([key, role]) => [key, role.id]));
  const channelMap = {};
  const categoryMap = {};

  for (const categorySpec of categories) {
    const category = await getOrCreateCategory(guild, categorySpec, report);
    categoryMap[categorySpec.key] = category.id;

    for (const channelSpec of categorySpec.channels) {
      const channel = await getOrCreateChannel(guild, category, roleIds, channelSpec, report);
      channelMap[channelSpec.key] = channel;
    }
  }

  await sendPanels(guild.id, channelMap, report);

  const ownerMember = await guild.members.fetch(ownerDiscordId).catch(() => null);
  const setup = saveGuildSetup(guild.id, {
    guildId: guild.id,
    sourceGuildId: sourceGuild?.id || null,
    sourceGuildName: sourceGuild?.name || null,
    ownerDiscordId,
    ownerTag: ownerMember?.user?.tag || null,
    roles: roleIds,
    channels: Object.fromEntries(Object.entries(channelMap).map(([key, channel]) => [key, channel.id])),
    categories: categoryMap,
    activatedBy: interaction.user.id,
    activatedAt: new Date().toISOString()
  });

  const finalEmbed = new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('✅ Servidor configurado com sucesso!')
    .addFields(
      { name: 'Categorias criadas', value: String(report.created.categories.length), inline: true },
      { name: 'Canais criados', value: String(report.created.channels.length), inline: true },
      { name: 'Cargos criados', value: String(report.created.roles.length), inline: true },
      { name: 'Painéis enviados', value: String(report.created.panels.length), inline: true },
      { name: '⚙️ Sistemas ativos', value: '6', inline: true },
      { name: 'Itens já existentes', value: String(report.skipped.roles.length + report.skipped.categories.length + report.skipped.channels.length), inline: true },
      { name: 'Origem/modelo', value: sourceGuild ? `${sourceGuild.name}\n\`${sourceGuild.id}\`` : 'nao informado', inline: true },
      { name: 'Destino', value: `${guild.name}\n\`${guild.id}\``, inline: true },
      { name: 'Dono/responsavel', value: `<@${ownerDiscordId}>\n\`${ownerDiscordId}\``, inline: true },
      { name: 'Cargo Dono', value: ownerAssignment, inline: true }
    )
    .setFooter({ text: `Configurado por ${interaction.user.tag}` })
    .setTimestamp();

  const logs = channelMap.generalLogs;
  if (logs?.isTextBased()) {
    await logs.send(toComponentsV2({ embeds: [finalEmbed] }));
  }

  await interaction.editReply(toComponentsV2({
    embeds: [
      finalEmbed.setDescription(
        setup ? 'Configuração salva e painéis publicados. Nenhum canal ou cargo existente foi apagado.' : 'Configuração concluída.'
      )
    ],
    components: []
  }));

  return report;
}

module.exports = {
  runSetup
};
