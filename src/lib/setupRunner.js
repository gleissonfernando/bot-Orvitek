const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { categories, colors, roleSpecs, staffRoleKeys } = require('../config/setup');
const { saveGuildSetup } = require('./store');
const { buildSupportRulesEmbeds } = require('./supportRules');
const { buildServerRulesEmbeds } = require('./serverRules');
const { buildHowItWorksEmbeds } = require('./howItWorks');
const { buildPlansButtons, buildPlansEmbeds } = require('./plans');
const { getSystemSettings } = require('./store');
const { replacePanelMessage } = require('./panelUtils');

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

async function sendPanel(channel, embed, components) {
  await replacePanelMessage(channel, {
    embeds: [embed],
    components
  });
}

function button(id, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

async function sendPanels(channels, report) {
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
    const settings = getSystemSettings(channels.plans.guild.id);
    await replacePanelMessage(channels.plans, {
      embeds: buildPlansEmbeds({ settings })
    });
  }

  await sendPanel(
    channels.buyNow,
    new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle('Adquira seu Plano')
      .setDescription(
        'Escolha o plano ideal para você e tenha acesso imediato ao sistema.\n\n' +
          '**BÁSICO** — R$ XX,00/mês\nAcesso padrão ao sistema, suporte via ticket\n\n' +
          '**PROFISSIONAL** — R$ XX,00/mês\nTudo do básico + acesso VIP + suporte prioritário\n\n' +
          '**VITALÍCIO** — R$ XX,00 único\nAcesso permanente + todos os benefícios'
      )
      .setFooter({ text: 'Após o pagamento, envie o comprovante no suporte.' }),
    [
      new ActionRowBuilder().addComponents(
        button('plan_basic', 'Básico', ButtonStyle.Secondary),
        button('plan_pro', 'Profissional', ButtonStyle.Secondary),
        button('plan_lifetime', 'Vitalício', ButtonStyle.Secondary),
        button('plan_paid', 'Já paguei', ButtonStyle.Success)
      )
    ]
  );
  report.created.panels.push('Compra');

  await sendPanel(
    channels.openTicket,
    new EmbedBuilder()
      .setColor(colors.blue)
      .setTitle('Central de Suporte')
      .setDescription(
        'Precisa de ajuda? Abra um ticket e nossa equipe irá atendê-lo em breve.\n\n' +
          '⏱️ Horário de atendimento: Seg-Sex, 9h-18h\nDescreva seu problema com detalhes para um atendimento mais rápido.'
      ),
    [
      new ActionRowBuilder().addComponents(
        button('ticket_bug', 'Reportar Bug', ButtonStyle.Danger),
        button('ticket_payment', 'Problema com Pagamento', ButtonStyle.Secondary),
        button('ticket_question', '❓ Dúvida Geral', ButtonStyle.Primary),
        button('ticket_technical', '⚙️ Suporte Técnico', ButtonStyle.Primary)
      )
    ]
  );
  report.created.panels.push('Suporte');

  await sendPanel(
    channels.renewPlan,
    new EmbedBuilder()
      .setColor(colors.orange)
      .setTitle('Renovação de Plano')
      .setDescription('Seu plano expirou ou está prestes a vencer. Renove agora para não perder o acesso!\n\n⚠️ Clientes com plano expirado têm acesso limitado ao servidor.'),
    [
      new ActionRowBuilder().addComponents(
        button('renew_now', 'Renovar Agora', ButtonStyle.Success),
        button('renew_check', 'Já renovei, verificar acesso', ButtonStyle.Secondary)
      )
    ]
  );
  report.created.panels.push('Renovação');

  await sendPanel(
    channels.suggestions,
    new EmbedBuilder()
      .setColor(colors.purple)
      .setTitle('Caixa de Sugestões')
      .setDescription('Tem uma ideia para melhorar nosso produto ou servidor? Compartilhe com a gente!'),
    [new ActionRowBuilder().addComponents(button('suggestion_open', 'Enviar Sugestão', ButtonStyle.Primary))]
  );
  report.created.panels.push('Sugestões');
}

async function runSetup(interaction) {
  const guild = interaction.guild;
  const report = {
    created: { roles: [], categories: [], channels: [], panels: [] },
    skipped: { roles: [], categories: [], channels: [] },
    errors: []
  };

  const roles = {};
  for (const spec of roleSpecs) {
    const role = await getOrCreateRole(guild, spec, report);
    roles[spec.key] = role;
  }

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

  await sendPanels(channelMap, report);

  const setup = saveGuildSetup(guild.id, {
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
      { name: 'Itens já existentes', value: String(report.skipped.roles.length + report.skipped.categories.length + report.skipped.channels.length), inline: true }
    )
    .setFooter({ text: `Configurado por ${interaction.user.tag}` })
    .setTimestamp();

  const logs = channelMap.generalLogs;
  if (logs?.isTextBased()) {
    await logs.send({ embeds: [finalEmbed] });
  }

  await interaction.editReply({
    embeds: [
      finalEmbed.setDescription(
        setup ? 'Configuração salva e painéis publicados. Nenhum canal ou cargo existente foi apagado.' : 'Configuração concluída.'
      )
    ],
    components: []
  });

  return report;
}

module.exports = {
  runSetup
};
