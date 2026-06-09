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
  const guild = interaction.guild;
  const ownerDiscordId = String(options.ownerDiscordId || '').trim() || interaction.user.id;
  const report = {
    created: { roles: [], categories: [], channels: [], panels: [] },
    assigned: { roles: [] },
    skipped: { roles: [], categories: [], channels: [] },
    errors: []
  };

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
      { name: 'Servidor', value: `\`${guild.id}\``, inline: true },
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
