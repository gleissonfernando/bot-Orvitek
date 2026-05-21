const { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const ativar = require('./ativar');
const { colors, staffRoleKeys } = require('../config/setup');
const { privateReply } = require('../lib/replies');
const { isStaff } = require('../lib/permissions');
const {
  expireClient,
  getClient,
  getGuildSetup,
  getReport,
  getTicketByChannel,
  listClients,
  setRetailPromotion,
  updateSystemSettings,
  updateTicket,
  upsertClient
} = require('../lib/store');
const {
  buildSystemPanelButtons,
  buildSystemPanelEmbed,
  restoreStaticPanel,
  sendRatingRequest,
  suppressPanelRestore
} = require('../lib/interactions');
const { buildPromotionEmbed } = require('../lib/plans');
const { buildNoticePayload, buildPlanSelectionPanelPayload } = require('../lib/planSelectionPanel');
const { buildVerificationPanel } = require('../lib/verificationPanel');
const { replacePanelMessage } = require('../lib/panelUtils');
const { toComponentsV2 } = require('../lib/componentsV2');

const DASHBOARD_ISSUE_TIMEOUT_MS = 10000;

function requireStaff(interaction) {
  if (isStaff(interaction.member)) {
    return true;
  }

  return false;
}

async function deny(interaction) {
  await interaction.reply(privateReply('Apenas Staff ou superior pode usar este comando.'));
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
}

function channelSafe(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function privateProjectOverwrites(guild, setup, userId, allowUser = false) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  if (allowUser && userId) {
    overwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const key of staffRoleKeys) {
    const roleId = setup.roles[key];
    if (roleId) {
      overwrites.push({
        id: roleId,
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

async function activateClient(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const setup = getGuildSetup(interaction.guild.id);
  if (!setup?.roles) {
    await interaction.reply(privateReply('Execute /ativar antes de gerenciar clientes.'));
    return;
  }

  const user = interaction.options.getUser('user', true);
  const plan = interaction.options.getString('plano', true);
  const days = interaction.options.getInteger('dias', true);
  const projectName = interaction.options.getString('projeto', true);
  const member = await interaction.guild.members.fetch(user.id);
  const expiresAt = addDays(days).toISOString();

  if (setup.roles.futureClient && member.roles.cache.has(setup.roles.futureClient)) {
    await member.roles.remove(setup.roles.futureClient).catch(() => null);
  }
  if (setup.roles.expired && member.roles.cache.has(setup.roles.expired)) {
    await member.roles.remove(setup.roles.expired).catch(() => null);
  }
  if (setup.roles.unverified && member.roles.cache.has(setup.roles.unverified)) {
    await member.roles.remove(setup.roles.unverified).catch(() => null);
  }
  if (setup.roles.active) {
    await member.roles.add(setup.roles.active);
  }
  if (plan === 'profissional' && setup.roles.vip) {
    await member.roles.add(setup.roles.vip);
  }

  const channelName = `projeto-${channelSafe(projectName)}-${channelSafe(user.username)}`.slice(0, 90);
  let projectChannel = interaction.guild.channels.cache.find((channel) => channel.name === channelName && channel.type === ChannelType.GuildText);

  if (!projectChannel) {
    projectChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: setup.categories.customers || null,
      permissionOverwrites: privateProjectOverwrites(interaction.guild, setup, user.id, false),
      reason: `Canal privado do projeto de ${user.tag}`
    });

    await projectChannel.send(toComponentsV2({
      content: `<@${user.id}>`,
      embeds: [
        new EmbedBuilder()
          .setColor(colors.default)
          .setTitle('Canal privado do projeto')
          .setDescription(`Este canal foi criado para acompanhar o projeto **${projectName}**.`)
          .addFields(
            { name: 'Cliente', value: user.tag, inline: true },
            { name: 'Plano', value: plan, inline: true },
            { name: 'Vencimento', value: formatDate(expiresAt), inline: true }
          )
          .setTimestamp()
      ]
    }));
  }

  upsertClient(interaction.guild.id, user.id, {
    userTag: user.tag,
    plan,
    projectName,
    projectChannelId: projectChannel.id,
    status: 'active',
    expiresAt,
    activatedBy: interaction.user.id
  });

  await interaction.reply(privateReply(`Cliente ${user.tag} ativado no plano ${plan} até ${formatDate(expiresAt)}. Canal criado: ${projectChannel}.`));
}

async function expireClientCommand(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const setup = getGuildSetup(interaction.guild.id);
  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (member && setup?.roles) {
    if (setup.roles.active) await member.roles.remove(setup.roles.active).catch(() => null);
    if (setup.roles.vip) await member.roles.remove(setup.roles.vip).catch(() => null);
    if (setup.roles.expired) await member.roles.add(setup.roles.expired).catch(() => null);
  }

  expireClient(interaction.guild.id, user.id);
  await interaction.reply(privateReply(`Cliente ${user.tag} marcado como expirado.`));
}

async function renewClient(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const user = interaction.options.getUser('user', true);
  const days = interaction.options.getInteger('dias', true);
  const current = getClient(interaction.guild.id, user.id);
  const base = current?.expiresAt && new Date(current.expiresAt) > new Date() ? new Date(current.expiresAt) : new Date();
  base.setDate(base.getDate() + days);
  upsertClient(interaction.guild.id, user.id, { status: 'active', expiresAt: base.toISOString() });
  await interaction.reply(privateReply(`Cliente ${user.tag} renovado até ${formatDate(base)}.`));
}

async function viewClients(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const clients = listClients(interaction.guild.id, 'active');
  await interaction.reply(privateReply({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Clientes ativos')
        .setDescription(
          clients.length
            ? clients.map((client) => `**${client.userTag || client.userId}** - ${client.plan || 'plano'} - vence em ${formatDate(client.expiresAt)}`).join('\n')
            : 'Nenhum cliente ativo encontrado.'
        )
    ]
  }));
}

async function sendWarning(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const user = interaction.options.getUser('user', true);
  const message = interaction.options.getString('mensagem', true);
  await user.send(toComponentsV2({
    embeds: [new EmbedBuilder().setColor(colors.orange).setTitle('Aviso da equipe').setDescription(message)]
  })).catch(() => null);
  await interaction.reply(privateReply(`Aviso enviado para ${user.tag}.`));
}

async function announce(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const channel = interaction.options.getChannel('canal', true);
  const message = interaction.options.getString('mensagem', true);
  if (channel.type !== ChannelType.GuildText) {
    await interaction.reply(privateReply('Selecione um canal de texto.'));
    return;
  }

  await channel.send(toComponentsV2({
    embeds: [new EmbedBuilder().setColor(colors.gold).setTitle('Anúncio Oficial').setDescription(message).setTimestamp()]
  }));
  await interaction.reply(privateReply(`Anúncio enviado em ${channel}.`));
}

async function closeTicket(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply(privateReply('Este comando deve ser usado dentro de um ticket.'));
    return;
  }

  updateTicket(interaction.channelId, { status: 'closed', closedAt: new Date().toISOString() });
  const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
  if (owner) await sendRatingRequest(owner, ticket.id);
  await interaction.reply(toComponentsV2('Ticket fechado. Este canal será removido em 10 segundos.'));
  setTimeout(() => interaction.channel.delete('Ticket fechado').catch(() => null), 10000);
}

async function reportCommand(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const report = getReport(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setColor(colors.default)
    .setTitle(`Relatório Semanal — ${new Intl.DateTimeFormat('pt-BR').format(new Date())}`)
    .setDescription(
      `Membros totais: ${interaction.guild.memberCount}\n` +
        `✅ Clientes ativos: ${report.activeClients}\n` +
        `⏳ Clientes expirados: ${report.expiredClients}\n` +
        `Tickets abertos: ${report.openTickets}\n` +
        `Tickets resolvidos: ${report.resolvedTickets}\n` +
        '⏱️ Tempo médio de resposta: 0 min\n' +
        `⭐ Avaliação média: ${report.averageRating.toFixed(1)}/5`
    );

  await interaction.reply(toComponentsV2({ embeds: [embed] }));
}

async function banCommand(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('motivo', true);
  await interaction.guild.members.ban(user.id, { reason });
  await interaction.reply(privateReply(`${user.tag} foi banido. Motivo: ${reason}`));
}

async function myPlan(interaction) {
  const client = getClient(interaction.guild.id, interaction.user.id);
  await interaction.reply(privateReply({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Meu plano')
        .setDescription(
          client
            ? `Plano: **${client.plan || 'cliente'}**\nStatus: **${client.status}**\nVencimento: **${client.expiresAt ? formatDate(client.expiresAt) : 'sem data'}**`
            : 'Você ainda não possui um plano ativo registrado.'
        )
    ]
  }));
}

async function supportCommand(interaction) {
  await interaction.reply(privateReply('Use o painel em #abrir-ticket para escolher o tipo de suporte.'));
}

async function renewCommand(interaction) {
  await interaction.reply(privateReply('Use o canal #renovar-plano para ver as opções de renovação.'));
}

async function rateCommand(interaction) {
  await sendRatingRequest(interaction.user);
  await interaction.reply(privateReply('Enviei a avaliação no seu privado.'));
}

async function verifySiteCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply(privateReply('Use este comando dentro do servidor para validar o acesso da dashboard.'));
    return;
  }

  await interaction.deferReply({ flags: 64 });

  const result = await issueDashboardPanelCode(interaction);

  await interaction.editReply(toComponentsV2(
    result.ok
      ? `Seu codigo da Orvitek e: **${result.code}**\nDigite esse codigo na dashboard.`
      : result.message
  ));
}

function stripTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getDashboardIssueEndpoint() {
  const baseUrl = stripTrailingSlashes(process.env.DASHBOARD_URL);
  return baseUrl ? `${baseUrl}/api/auth/panel/issue` : null;
}

function buildDashboardIssueBody(interaction) {
  return {
    userId: interaction.user.id,
    username: interaction.user.username,
    globalName: interaction.user.globalName,
    avatar: interaction.user.avatar,
    guildId: interaction.guild.id,
    guildName: interaction.guild.name,
    memberPermissions: interaction.memberPermissions.bitfield.toString(),
    owner: interaction.guild.ownerId === interaction.user.id
  };
}

function normalizeDashboardIssueCode(code) {
  const normalized = String(code || '').trim();
  return /^\d{4}$/.test(normalized) ? normalized : null;
}

async function readDashboardResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function dashboardErrorMessage(payload, response) {
  if (payload && typeof payload === 'object') {
    const message = payload.message || payload.error || payload.reason || payload.details;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  if (response) {
    return `Erro ${response.status} ao solicitar o codigo na dashboard.`;
  }

  return 'Nao foi possivel solicitar o codigo na dashboard.';
}

async function issueDashboardPanelCode(interaction) {
  const endpoint = getDashboardIssueEndpoint();
  const token = String(process.env.BOT_DASHBOARD_TOKEN || '').trim();

  if (!endpoint) {
    return { ok: false, message: 'Configure DASHBOARD_URL no .env para usar este comando.' };
  }

  if (!token) {
    return { ok: false, message: 'Configure BOT_DASHBOARD_TOKEN no .env para usar este comando.' };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, message: 'Fetch nativo indisponivel. Use Node.js 18 ou superior.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DASHBOARD_ISSUE_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Token': token
      },
      body: JSON.stringify(buildDashboardIssueBody(interaction)),
      signal: controller.signal
    });
    const payload = await readDashboardResponse(response);

    if (!response.ok || !payload?.ok) {
      return { ok: false, message: dashboardErrorMessage(payload, response) };
    }

    const code = normalizeDashboardIssueCode(payload.code);
    if (!code) {
      return { ok: false, message: 'A dashboard nao retornou um codigo de 4 digitos.' };
    }

    return { ok: true, code, expiresAt: payload.expiresAt || null };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, message: 'A dashboard demorou para responder. Tente novamente em instantes.' };
    }

    return { ok: false, message: `Nao foi possivel conectar na dashboard: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function retailCommand(interaction) {
  const mode = interaction.options.getString('modo', true);
  const active = mode === 'ativar';
  const setup = getGuildSetup(interaction.guild.id);

  if (!setup?.channels?.plans || !setup?.channels?.promotions) {
    await interaction.reply(privateReply('Execute /ativar antes de usar /varejo.'));
    return;
  }

  setRetailPromotion(interaction.guild.id, {
    active,
    updatedBy: interaction.user.id
  });

  const plansChannel = await interaction.guild.channels.fetch(setup.channels.plans).catch(() => null);
  const promotionsChannel = await interaction.guild.channels.fetch(setup.channels.promotions).catch(() => null);

  if (plansChannel?.isTextBased()) {
    suppressPanelRestore(plansChannel.id, 15000);
    await replacePanelMessage(plansChannel, buildPlanSelectionPanelPayload(), { deleteAll: true });
  }

  if (promotionsChannel?.isTextBased()) {
    const roleId = process.env.PROMOTION_ROLE_ID || '1505184193766752386';
    suppressPanelRestore(promotionsChannel.id, 15000);
    await replacePanelMessage(promotionsChannel, {
      content: active ? `<@&${roleId}>` : undefined,
      allowedMentions: active ? { roles: [roleId] } : undefined,
      embeds: [buildPromotionEmbed(active)]
    }, { deleteAll: true });
  }

  await interaction.reply(privateReply(active
    ? 'Promoção ativada: Básico 20% OFF, Premium 30% OFF e hospedagem sem alteração.'
    : 'Promoção desativada. O painel de planos foi publicado com valores normais.'
  ));
}

async function clearCommand(interaction) {
  if (!requireStaff(interaction)) {
    await deny(interaction);
    return;
  }

  const targetChannel = interaction.options.getChannel('canal') || interaction.channel;
  if (!targetChannel?.isTextBased()) {
    await interaction.reply(privateReply('Selecione um canal de texto.'));
    return;
  }

  await interaction.deferReply({ flags: 64 });

  suppressPanelRestore(targetChannel.id, 5000);
  let before;
  while (true) {
    const messages = await targetChannel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const message of messages.values()) {
      await message.delete().catch(() => null);
    }

    before = messages.last().id;
  }

  await restoreStaticPanel(targetChannel.guild, targetChannel.id, { skipAuthorCheck: true });
  await interaction.editReply(toComponentsV2(`Canal limpo: ${targetChannel}.`));
}

async function salesPanelCommand(interaction) {
  const selectedChannel = interaction.options.getChannel('canal');
  const targetChannel = selectedChannel || interaction.channel;

  if (!targetChannel?.isTextBased()) {
    await interaction.reply(buildNoticePayload('Selecione um canal de texto ou use o comando em um canal de texto.', 0xff4757));
    return;
  }

  suppressPanelRestore(targetChannel.id, 15000);
  await replacePanelMessage(targetChannel, buildPlanSelectionPanelPayload(), { deleteAll: true });
  await interaction.reply(buildNoticePayload(`✅ Painel de vendas enviado em ${targetChannel}.`));
}

async function systemPanelCommand(interaction) {
  const selectedChannel = interaction.options.getChannel('canal');
  const targetChannel = selectedChannel || interaction.channel;

  if (!targetChannel?.isTextBased()) {
    await interaction.reply(buildNoticePayload('Selecione um canal de texto ou use o comando em um canal de texto.', 0xff4757));
    return;
  }

  updateSystemSettings(interaction.guild.id, {
    ui: {
      systemPanelChannelId: targetChannel.id,
      systemPanelUpdatedBy: interaction.user.id,
      systemPanelUpdatedAt: new Date().toISOString()
    }
  });

  suppressPanelRestore(targetChannel.id, 15000);
  await replacePanelMessage(targetChannel, {
    embeds: [buildSystemPanelEmbed(interaction.guild)],
    components: buildSystemPanelButtons()
  }, { deleteAll: true });

  await interaction.reply(buildNoticePayload(`✅ Painel de controle enviado em ${targetChannel}.`));
}

async function verificationPanelCommand(interaction) {
  await interaction.deferReply({ flags: 64 });

  const selectedChannel = interaction.options.getChannel('canal');
  const setup = getGuildSetup(interaction.guild.id);
  const targetChannel = selectedChannel || interaction.channel;

  if (!targetChannel?.isTextBased()) {
    await interaction.editReply(toComponentsV2('Use este comando em um canal de texto ou selecione um canal de texto.'));
    return;
  }

  if (setup?.channels?.verify && selectedChannel && selectedChannel.id !== setup.channels.verify) {
    await interaction.editReply(toComponentsV2('Painel enviado no canal selecionado. Observação: ele é diferente do canal de verificação salvo no setup.'));
    suppressPanelRestore(targetChannel.id, 15000);
    await replacePanelMessage(targetChannel, buildVerificationPanel(), { deleteAll: true });
    return;
  }

  suppressPanelRestore(targetChannel.id, 15000);
  await replacePanelMessage(targetChannel, buildVerificationPanel(), { deleteAll: true });
  await interaction.editReply(toComponentsV2(`Painel de verificação enviado em ${targetChannel}.`));
}

const commands = [
  ativar,
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Apaga todas as mensagens do canal e restaura o painel quando existir.')
      .addChannelOption((option) => option.setName('canal').setDescription('Canal para limpar').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    execute: clearCommand
  },
  {
    data: new SlashCommandBuilder()
      .setName('painel-verificar')
      .setDescription('Envia o painel de verificação no canal de verificação.')
      .addChannelOption((option) =>
        option.setName('canal').setDescription('Canal onde o painel será enviado. Se vazio, usa o canal atual.').setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    execute: verificationPanelCommand
  },
  {
    data: new SlashCommandBuilder()
      .setName('verificar')
      .setDescription('Verifica seu acesso aos serviços da Orvitek.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('site')
          .setDescription('Gera seu codigo para entrar na dashboard Orvitek.')
      ),
    allowNonOwner: true,
    execute: verifySiteCommand
  },
  {
    data: new SlashCommandBuilder()
      .setName('painel')
      .setDescription('Envia o painel de controle do sistema.')
      .addChannelOption((option) => option.setName('canal').setDescription('Canal onde o painel de controle será enviado.').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    execute: systemPanelCommand
  }
];

module.exports = commands;
