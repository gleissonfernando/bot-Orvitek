const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require('discord.js');
const crypto = require('node:crypto');
const { categories, colors, roleSpecs, staffRoleKeys } = require('../config/setup');
const { isOwnerRole, isStaff } = require('./permissions');
const { privateReply } = require('./replies');
const { toComponentsV2 } = require('./componentsV2');
const {
  addRating,
  addSuggestion,
  createTicket,
  deleteClient,
  getGuildSetup,
  getQueueEntry,
  listQueueEntries,
  getQueuePosition,
  getTicketByChannel,
  createContract,
  getContract,
  getClient,
  createDashboardVerificationCode,
  getPayment,
  getSystemSettings,
  clearSystemCoupon,
  getHostingCycleKey,
  getHostingGraceDeadline,
  getNextHostingDueDate,
  listDashboardAccess,
  listDashboardVerificationCodes,
  listClients,
  setSystemCoupon,
  updateTicket,
  updateSystemSettings,
  upsertPayment,
  upsertClient,
  upsertQueueEntry
} = require('./store');
const { runSetup } = require('./setupRunner');
const {
  buildAccessApprovalDm,
  buildAccessUnlockedDm,
  buildDashboardVerificationCodeDm,
  buildHostingAccessCreatedDm,
  buildDeliveryFeedbackDm,
  buildHostingBillingPanel,
  buildHostingPaymentInstructionDm,
  buildHostingOverdueDm,
  buildVerificationSuccessDm,
  sendDmPanel
} = require('./dmPanels');
const { buildSupportRulesEmbeds } = require('./supportRules');
const { buildServerRulesEmbeds } = require('./serverRules');
const { buildHowItWorksEmbeds } = require('./howItWorks');
const { buildVerificationPanel } = require('./verificationPanel');
const {
  buildContractButton,
  buildContractIntroEmbed,
  buildContractModal,
  buildContractSignedFollowupEmbed,
  buildSignedContractEmbed,
  generateContractPdf
} = require('./contracts');
const { buildPlansButtons, buildPlansEmbeds, buildPromotionEmbed, getBoostDiscountPercent, getPlanPricing } = require('./plans');
const {
  PLAN_SELECT_CUSTOM_ID,
  buildPlanSelectionPanelPayload,
  handlePlanButton,
  handlePlanSelection,
  handleReceiptModalSubmit
} = require('./planSelectionPanel');
const { replacePanelMessage } = require('./panelUtils');
const { buildRenewPanelPayload, buildSuggestionsPanelPayload, buildTicketPanelPayload } = require('./staticPanels');
const {
  buildPixPaymentFromOrder,
  consultOrder,
  createPixOrder,
  isBuyerMerchantEmailError,
  isPagBankConfigured,
  isPixCopyPasteText,
  summarizeOrderStatus,
  validatePagBankCustomer
} = require('./pagbank');

const PROJECT_ACCESS_CATEGORY_ID = process.env.PROJECT_ACCESS_CATEGORY_ID || '1505195763469127770';
const HOSTING_LOG_CHANNEL_ID = process.env.HOSTING_LOG_CHANNEL_ID || '1505275946721087730';
const TICKET_ALERT_ROLE_ID = process.env.TICKET_ALERT_ROLE_ID || '1505184193766752386';
const PAYMENT_REJECT_DELETE_MS = 3 * 60 * 60 * 1000;
const DELIVERED_PROJECT_CATEGORY_ID = process.env.DELIVERED_PROJECT_CATEGORY_ID || '1506262092565450963';
const CONTRACT_CHANNEL_DELETE_DELAY_MS = 5000;

const restoreSuppression = new Set();

function suppressPanelRestore(channelId, ttlMs = 10000) {
  restoreSuppression.add(channelId);
  setTimeout(() => restoreSuppression.delete(channelId), ttlMs).unref?.();
}

async function replaceStaticPanelMessage(channel, payload, options = {}) {
  suppressPanelRestore(channel.id, options.suppressionMs || 15000);
  return replacePanelMessage(channel, payload, { deleteAll: options.deleteAll !== false });
}

async function deleteActionPanel(interaction) {
  if (!interaction?.message?.deletable) return false;
  await interaction.message.delete().catch(() => null);
  return true;
}

function auditLogReason(prefix, detail = '') {
  const reason = detail ? `${prefix}: ${detail}` : prefix;
  return reason.slice(0, 500);
}

function scheduleChannelDeletion(channel, reason, delayMs = CONTRACT_CHANNEL_DELETE_DELAY_MS) {
  if (!channel?.deletable) return false;

  const timeout = setTimeout(() => {
    channel.delete(reason).catch(() => null);
  }, delayMs);
  timeout.unref?.();
  return true;
}

function isUnknownInteraction(error) {
  return error?.code === 10062 || String(error?.message || '').includes('Unknown interaction');
}

function normalizeSetupName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLowerCase();
}

function findRoleBySetupName(guild, expectedName) {
  const target = normalizeSetupName(expectedName);
  return guild.roles.cache.find((role) => normalizeSetupName(role.name) === target) || null;
}

function findChannelBySetupName(guild, expectedName, oldName = null) {
  const targets = [expectedName, oldName].filter(Boolean).map(normalizeSetupName);
  return guild.channels.cache.find((channel) => targets.includes(normalizeSetupName(channel.name))) || null;
}

function buildGuildSetupFallback(guild) {
  const roles = {};
  for (const spec of roleSpecs) {
    const role = findRoleBySetupName(guild, spec.name);
    if (role) roles[spec.key] = role.id;
  }

  const channelMap = {};
  const categoryMap = {};
  for (const categorySpec of categories) {
    const category = findChannelBySetupName(guild, categorySpec.name, categorySpec.oldName);
    if (category) categoryMap[categorySpec.key] = category.id;

    for (const channelSpec of categorySpec.channels) {
      const channel = findChannelBySetupName(guild, channelSpec.name, channelSpec.oldName);
      if (channel) channelMap[channelSpec.key] = channel.id;
    }
  }

  if (!Object.keys(roles).length && !Object.keys(channelMap).length && !Object.keys(categoryMap).length) {
    return null;
  }

  return {
    roles,
    channels: channelMap,
    categories: categoryMap,
    fallback: true
  };
}

function resolveGuildSetup(guild) {
  if (!guild) return null;
  return getGuildSetup(guild.id) || buildGuildSetupFallback(guild);
}

async function safeReply(interaction, payload) {
  try {
    const nextPayload = toComponentsV2(payload);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(nextPayload);
    } else {
      await interaction.reply(nextPayload);
    }
    return true;
  } catch (error) {
    if (isUnknownInteraction(error)) {
      console.warn(`Interação expirada ignorada: ${interaction.customId || interaction.commandName || interaction.id}`);
      return false;
    }
    throw error;
  }
}

async function safeUpdate(interaction, payload) {
  try {
    await interaction.update(toComponentsV2(payload));
    return true;
  } catch (error) {
    if (isUnknownInteraction(error)) {
      console.warn(`Interação expirada ignorada: ${interaction.customId || interaction.id}`);
      return false;
    }
    throw error;
  }
}

const ticketLabels = {
  ticket_bug: 'Reportar Bug',
  ticket_payment: 'Problema com Pagamento',
  ticket_question: 'Dúvida Geral',
  ticket_technical: 'Suporte Técnico',
  plan_basic: 'Compra - Básico',
  plan_pro: 'Compra - Profissional',
  plan_lifetime: 'Compra - Vitalício',
  plan_paid: 'Comprovante de Pagamento',
  renew_now: 'Renovação de Plano',
  renew_check: 'Verificar Renovação'
};

const ticketSlugs = {
  ticket_bug: 'bug',
  ticket_payment: 'pagamento',
  ticket_question: 'duvida',
  ticket_technical: 'tecnico',
  plan_basic: 'basico',
  plan_pro: 'premium',
  plan_lifetime: 'vitalicio',
  plan_paid: 'comprovante',
  renew_now: 'renovacao',
  renew_check: 'verificar-renovacao'
};

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

function staffOverwrites(guild, setup) {
  return staffRoleKeys
    .map((key) => setup.roles?.[key])
    .filter(Boolean)
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter(Boolean)
    .map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    }));
}

function getConfiguredRole(member, setup, key, fallbackName) {
  const roleId = setup.roles?.[key];
  if (roleId) {
    return member.guild.roles.cache.get(roleId) || null;
  }

  return member.guild.roles.cache.find((role) => role.name === fallbackName) || null;
}

async function resolveRole(guild, ids = [], fallbackName = null) {
  for (const id of ids.filter(Boolean)) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (role) return role;
  }

  if (!fallbackName) return null;
  const normalized = normalizeSetupName(fallbackName);
  return guild.roles.cache.find((role) => normalizeSetupName(role.name) === normalized) || null;
}

async function addConfiguredRole(member, setup, key, fallbackName) {
  const role = getConfiguredRole(member, setup, key, fallbackName);
  if (role) {
    await member.roles.add(role).catch(() => null);
  }
}

async function ensureProgressRole(member, setup, key, fallbackName, color = colors.default) {
  let role = getConfiguredRole(member, setup, key, fallbackName);
  if (!role) {
    role = member.guild.roles.cache.find((item) => normalizeSetupName(item.name) === normalizeSetupName(fallbackName)) || null;
  }

  if (!role && member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    role = await member.guild.roles.create({
      name: fallbackName,
      color,
      permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      reason: 'Cargo automático de andamento do projeto'
    }).catch(() => null);
  }

  return role;
}

async function addRoleById(member, roleId, reason) {
  const role = roleId ? await member.guild.roles.fetch(roleId).catch(() => null) : null;
  if (!role) {
    console.warn(`Cargo não encontrado para ${member.user.tag}: ${roleId}`);
    return false;
  }

  if (!role.editable) {
    console.warn(`Bot sem permissão/hierarquia para adicionar ${role.name} (${role.id}) em ${member.user.tag}.`);
    return false;
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, reason);
  }
  return true;
}

async function removeConfiguredRole(member, setup, key, fallbackName) {
  const role = getConfiguredRole(member, setup, key, fallbackName);
  if (role && member.roles.cache.has(role.id)) {
    await member.roles.remove(role).catch(() => null);
  }
}

async function applyProjectProgressRoles(member, setup, status) {
  const statusRoles = [
    { key: 'queue', name: 'Na Fila' },
    { key: 'development', name: 'Bot em Desenvolvimento' },
    { key: 'delivered', name: 'Bot Entregue' }
  ];

  for (const item of statusRoles) {
    await removeConfiguredRole(member, setup, item.key, item.name);
  }

  if (status === 'queue') {
    const role = await ensureProgressRole(member, setup, 'queue', 'Na Fila', colors.orange);
    if (role) await member.roles.add(role).catch(() => null);
  }

  if (['started', 'development', 'testing', 'configuration'].includes(status)) {
    const role = await ensureProgressRole(member, setup, 'development', 'Bot em Desenvolvimento', colors.blue);
    if (role) await member.roles.add(role).catch(() => null);
  }

  if (status === 'finished') {
    const role = await ensureProgressRole(member, setup, 'delivered', 'Bot Entregue', colors.default);
    if (role) await member.roles.add(role).catch(() => null);
  }
}

function purchaseTypes(type) {
  return ['plan_basic', 'plan_pro', 'plan_lifetime', 'plan_paid'].includes(type);
}

function planValueFromType(typeOrPlan) {
  if (typeOrPlan === 'plan_pro' || typeOrPlan === 'premium' || typeOrPlan === 'profissional') return 'premium';
  if (typeOrPlan === 'plan_lifetime' || typeOrPlan === 'vitalicio') return 'vitalicio';
  if (typeOrPlan === 'plan_paid' || typeOrPlan === 'comprovante') return 'comprovante';
  return 'basico';
}

function isBlockingContractRecord(record) {
  if (!record || record.contractEndedAt || record.status === 'contract_ended') return false;
  if (['deleted_preapproved', 'cancelled', 'payment_rejected', 'expired'].includes(record.status)) return false;
  if (['deleted', 'cancelled', 'payment_rejected'].includes(record.hostingStatus)) return false;

  return [
    'active',
    'pending_payment',
    'pending_access',
    'access_key_created',
    'awaiting_pagbank_payment',
    'awaiting_manual_payment',
    'approved',
    'development',
    'ready'
  ].includes(record.status) || ['current', 'suspended', 'awaiting_payment'].includes(record.hostingStatus);
}

function findClientQueueEntry(guildId, userId, clientRecord = {}) {
  const entries = listQueueEntries(guildId, userId);
  return entries.find((entry) => entry.channelId === clientRecord.paymentTicketChannelId)
    || entries.find((entry) => entry.projectChannelId && entry.projectChannelId === clientRecord.projectChannelId)
    || entries.find((entry) => isBlockingContractRecord(entry))
    || entries[0]
    || null;
}

function brl(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function generateAccessPassword() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateAccessKey(projectName, suffix = null) {
  const slug = channelSafe(projectName || 'projeto').replace(/^-+|-+$/g, '') || 'projeto';
  const base = `orvitek-${slug}`.slice(0, 58);
  return suffix ? `${base}-${suffix}`.slice(0, 64) : base;
}

function getEntryPaymentAmount(contract) {
  const final = Number(contract?.finalPrice);
  if (Number.isFinite(final) && final > 0) {
    return final;
  }

  const entry = Number(contract?.entryPrice);
  return Number.isFinite(entry) && entry > 0 ? entry : 0;
}

function buildPagBankReference(guildId, channelId) {
  return `orvitek-${guildId}-${channelId}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function paymentIsReusable(payment) {
  if (!payment || payment.provider !== 'pagbank' || payment.status === 'paid' || !payment.orderId) {
    return false;
  }

  if (!payment.expiresAt) {
    return true;
  }

  return Date.now() < new Date(payment.expiresAt).getTime();
}

function paymentStatusLabel(payment) {
  if (payment?.status === 'paid') return 'Pago';
  if (payment?.status === 'expired') return 'Expirado';
  if (payment?.status === 'failed') return 'Falhou';
  return 'Aguardando pagamento';
}

function paymentModeLabel(mode) {
  if (mode === 'pix_key') return 'Chave Pix manual';
  if (mode === 'qr_code') return 'QR Code Pix manual';
  return 'PagBank automático';
}

function hasManualPaymentConfig(settings, mode) {
  if (mode === 'pix_key') return Boolean(settings.payment?.pixKey);
  if (mode === 'qr_code') return Boolean(settings.payment?.qrCodeText || settings.payment?.qrCodeImageUrl);
  return false;
}

function resolvePurchasePaymentMode(settings) {
  const selectedMode = settings.payment?.mode || 'pagbank';

  if (selectedMode === 'pagbank' && isPagBankConfigured()) {
    return { mode: 'pagbank', selectedMode };
  }

  if ((selectedMode === 'pix_key' || selectedMode === 'qr_code') && hasManualPaymentConfig(settings, selectedMode)) {
    return { mode: selectedMode, selectedMode };
  }

  if (isPagBankConfigured()) {
    return { mode: 'pagbank', selectedMode, fallback: true };
  }

  if (hasManualPaymentConfig(settings, 'pix_key')) {
    return { mode: 'pix_key', selectedMode, fallback: true };
  }

  if (hasManualPaymentConfig(settings, 'qr_code')) {
    return { mode: 'qr_code', selectedMode, fallback: true };
  }

  return { mode: null, selectedMode };
}

function truncatePixCode(value) {
  const text = String(value || '').trim();
  if (!text) return 'Código Pix não retornado pelo PagBank.';
  return text;
}

function buildPagBankPaymentEmbed(payment, contract) {
  const embed = new EmbedBuilder()
    .setColor(payment?.status === 'paid' ? colors.default : colors.gold)
    .setTitle('Pagamento Pix PagBank')
    .setDescription(
      payment?.status === 'paid'
        ? 'O pagamento foi confirmado pelo PagBank.'
        : 'Pague pelo QR Code ou use o Pix copia e cola abaixo. Depois clique em **Verificar PagBank**.'
    )
    .addFields(
      { name: 'Valor a pagar', value: brl((payment?.amountCents || 0) / 100), inline: true },
      { name: 'Status', value: paymentStatusLabel(payment), inline: true },
      { name: 'Pedido PagBank', value: payment?.orderId ? `\`${payment.orderId}\`` : 'não gerado', inline: true },
      { name: 'Projeto', value: contract?.projectName || 'não informado', inline: true }
    )
    .setTimestamp();

  if (payment?.expiresAt && payment.status !== 'paid') {
    embed.addFields({ name: 'Expira em', value: `<t:${Math.floor(new Date(payment.expiresAt).getTime() / 1000)}:R>`, inline: true });
  }

  if (payment?.qrCodeText && payment.status !== 'paid') {
    embed.addFields({ name: 'Pix copia e cola', value: `\`\`\`${truncatePixCode(payment.qrCodeText)}\`\`\`` });
  }

  if (payment?.qrCodePng && payment.status !== 'paid') {
    embed.addFields({ name: 'Imagem do QR Code', value: `[Abrir QR Code](${payment.qrCodePng})`, inline: true });
    embed.setImage(payment.qrCodePng);
  }

  return embed;
}

function buildPagBankPaymentActions() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('payment_check').setLabel('Verificar PagBank').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('payment_approve').setLabel('Aprovar manualmente').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('payment_reject').setLabel('Recusar pagamento').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function refreshPagBankPaymentDetails(payment, channelId) {
  const hasPublicQrImage = payment?.qrCodePng && !String(payment.qrCodePng).includes('api.pagseguro.com/qrcode/');
  const hasValidPixText = isPixCopyPasteText(payment?.qrCodeText);
  if (!payment?.orderId || (hasValidPixText && hasPublicQrImage)) {
    return payment;
  }

  const order = await consultOrder(payment.orderId);
  const refreshed = await buildPixPaymentFromOrder(order, payment.amountCents || null, payment.referenceId || order.reference_id || null);
  return upsertPayment(channelId, {
    ...payment,
    ...refreshed,
    guildId: payment.guildId,
    userId: payment.userId,
    userTag: payment.userTag,
    contractId: payment.contractId,
    projectName: payment.projectName,
    plan: payment.plan,
    createdAt: payment.createdAt || refreshed.createdAt
  });
}

function buildManualPixPaymentEmbed(settings, contract, amount) {
  const payment = settings.payment || {};
  const mode = payment.mode;
  const embed = new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle(mode === 'pix_key' ? 'Pagamento por chave Pix' : 'Pagamento por QR Code Pix')
    .setDescription(
      mode === 'pix_key'
        ? 'Faça o Pix usando a chave abaixo. Depois aguarde a aprovação da equipe.'
        : 'Pague usando o QR Code ou o copia e cola abaixo. Depois aguarde a aprovação da equipe.'
    )
    .addFields(
      { name: 'Projeto', value: contract?.projectName || 'não informado', inline: true },
      { name: 'Valor a pagar', value: brl(amount), inline: true },
      { name: 'Status', value: 'Aguardando aprovação manual', inline: true }
    )
    .setTimestamp();

  if (mode === 'pix_key') {
    embed.addFields(
      { name: 'Chave Pix', value: `\`\`\`${payment.pixKey || 'não cadastrada'}\`\`\`` },
      { name: 'Identificação', value: payment.pixKeyLabel || 'Orvitek', inline: true }
    );
  } else {
    if (payment.qrCodeText) {
      embed.addFields({ name: 'Pix copia e cola', value: `\`\`\`${truncatePixCode(payment.qrCodeText)}\`\`\`` });
    }
    if (payment.qrCodeImageUrl) {
      embed.setImage(payment.qrCodeImageUrl);
    }
  }

  return embed;
}

function buildManualPixPaymentActions() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('payment_approve').setLabel('Pagamento aprovado').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('payment_reject').setLabel('Pagamento recusado').setStyle(ButtonStyle.Danger)
    )
  ];
}

function planLabel(typeOrPlan) {
  if (typeOrPlan === 'plan_pro' || typeOrPlan === 'premium' || typeOrPlan === 'profissional') return 'Plano Premium';
  if (typeOrPlan === 'plan_lifetime' || typeOrPlan === 'vitalicio') return 'Plano Vitalício';
  if (typeOrPlan === 'plan_paid' || typeOrPlan === 'comprovante') return 'Compra personalizada';
  return 'Plano Básico';
}

function buildPurchaseReceiptEmbed({ guild, ticket, contract, queueEntry, payment, approvedByUserId }) {
  const paidValue =
    Number(payment?.amountCents) > 0
      ? Number(payment.amountCents) / 100
      : Number(queueEntry?.finalPrice || contract?.finalPrice || 0);
  const receiptId = `ORV-${contract?.id || ticket?.id || 'COMPRA'}-${String(Date.now()).slice(-6)}`;

  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('Comprovante de compra - Orvitek')
    .setDescription('Pagamento confirmado. Guarde este comprovante para acompanhar sua compra.')
    .addFields(
      { name: 'Empresa', value: 'Orvitek', inline: true },
      { name: 'Comprovante', value: `\`${receiptId}\``, inline: true },
      { name: 'Servidor', value: guild?.name || 'Orvitek', inline: true },
      { name: 'Cliente', value: ticket?.ownerTag || contract?.userTag || 'não informado', inline: true },
      { name: 'Produto comprado', value: planLabel(contract?.planType || ticket?.type || queueEntry?.plan), inline: true },
      { name: 'Projeto/Bot', value: contract?.projectName || queueEntry?.projectName || 'não informado', inline: true },
      { name: 'Valor pago', value: brl(paidValue), inline: true },
      { name: 'Forma de pagamento', value: payment?.provider === 'pagbank' ? 'Pix PagBank' : 'Aprovação manual', inline: true },
      { name: 'Pedido PagBank', value: payment?.orderId ? `\`${payment.orderId}\`` : 'não informado', inline: true },
      { name: 'Data', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: 'Confirmado por', value: approvedByUserId ? `<@${approvedByUserId}>` : 'Sistema', inline: true }
    )
    .setFooter({ text: 'Orvitek - comprovante gerado automaticamente pelo bot.' })
    .setTimestamp();
}

function hashHostingPassword(password, salt = null) {
  const finalSalt = salt || crypto.randomBytes(16).toString('hex');
  const digest = crypto.createHash('sha256').update(`${finalSalt}:${password}`).digest('hex');
  return { salt: finalSalt, hash: digest };
}

function verifyHostingPassword(password, salt, hash) {
  if (!salt || !hash) {
    return false;
  }

  return hashHostingPassword(password, salt).hash === hash;
}

function getProjectChannelName(projectName, username) {
  return `projeto-${channelSafe(projectName)}-${channelSafe(username)}`.slice(0, 90);
}

function getProjectCategoryName(projectName, username) {
  return `cliente-${channelSafe(username)}-${channelSafe(projectName)}`.slice(0, 90);
}

function getTimeGreeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo'
  }).format(date));

  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function findClientByInput(guildId, input) {
  const normalized = String(input || '').trim().replace(/[<@!>]/g, '');
  if (!normalized) {
    return null;
  }

  const direct = listClients(guildId).find((client) => client.userId === normalized);
  if (direct) {
    return direct;
  }

  const lower = normalized.toLowerCase();
  return listClients(guildId).find(
    (client) =>
      String(client.userTag || '').toLowerCase().includes(lower) ||
      String(client.projectName || '').toLowerCase().includes(lower) ||
      String(client.userId || '').includes(lower)
  ) || null;
}

function findClientByProjectChannel(guildId, channelId) {
  return listClients(guildId).find((client) => client.projectChannelId === channelId) || null;
}

function projectChannelOverwrites(guild, setup, userId = null, allowUser = false) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
  ];

  if (userId) {
    overwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: allowUser ? [] : [PermissionFlagsBits.SendMessages]
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

function buildContractOnlyActions() {
  return [
    ...buildContractButton(),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('coupon_apply').setLabel('Tenho cupom').setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildContractCorrectionActions() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('contract_start').setLabel('Corrigir contrato').setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildPreApprovedPanel(contract) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Pré aprovado')
        .setDescription(
          'Contrato assinado. Agora o cliente cadastra a chave de acesso, gera o Pix PagBank e aguarda a confirmação do pagamento.'
        )
        .addFields(
          { name: 'Cliente', value: contract.fullName || contract.userTag || 'não informado', inline: true },
          { name: 'Projeto', value: contract.projectName || 'não informado', inline: true },
          { name: 'Status', value: 'Aguardando chave e Pix', inline: true }
        )
        .setFooter({ text: 'Somente o cliente usa os botões de chave, Pix e verificação. A aprovação manual continua disponível para a administração.' })
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hosting_access_create').setLabel('Cadastrar chave de acesso').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('payment_approve').setLabel('Pagamento aprovado').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('payment_reject').setLabel('Pagamento recusado').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('preapproved_delete_channel').setLabel('Apagar canal').setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function buildPaymentStepPanel(contract, queueEntry = {}) {
  const paymentPrice = getEntryPaymentAmount(contract);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Pagamento do plano')
        .setDescription(
          `A chave do projeto **${queueEntry.projectName || contract?.projectName || 'seu projeto'}** foi criada.\n\n` +
            'Agora gere o pagamento Pix do plano. Se for PagBank, use **Verificar PagBank** depois do pagamento; se for manual, aguarde a aprovação da equipe.'
        )
        .addFields(
          { name: 'Chave de acesso', value: queueEntry.accessKey ? `\`${queueEntry.accessKey}\`` : 'criada', inline: true },
          { name: 'Valor a pagar', value: brl(paymentPrice), inline: true },
          { name: 'Status', value: 'Aguardando pagamento Pix', inline: true }
        )
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('queue_join').setLabel('Gerar pagamento Pix').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('payment_check').setLabel('Verificar PagBank').setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('payment_approve').setLabel('Aprovar manualmente').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('payment_reject').setLabel('Recusar pagamento').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('preapproved_delete_channel').setLabel('Apagar canal').setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function buildProjectAccessPanel(queueEntry) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Liberar acesso ao projeto')
        .setDescription(
          `O canal do projeto **${queueEntry.projectName || 'seu projeto'}** foi criado.\n\n` +
            'Clique no botão abaixo e informe sua chave de acesso e senha. Depois da confirmação, você poderá enviar mensagens neste canal.'
        )
        .addFields(
          { name: 'Status', value: 'Aguardando chave e senha', inline: true },
          { name: 'Chave', value: queueEntry.accessKey ? `\`${queueEntry.accessKey}\`` : 'criada pelo cliente', inline: true }
        )
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`access_unlock:${queueEntry.channelId}`)
          .setLabel('Colocar chave e senha')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`access_recover:${queueEntry.channelId}`)
          .setLabel('Recuperar senha')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`access_change:${queueEntry.channelId}`)
          .setLabel('Mudar senha')
          .setStyle(ButtonStyle.Success)
      )
    ]
  };
}

function buildProjectSupportPanel(queueEntry) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.blue)
        .setTitle('Suporte')
        .setDescription('Use o botão abaixo quando precisar chamar a equipe para este projeto.')
        .addFields(
          { name: 'Projeto', value: queueEntry.projectName || 'não informado', inline: true },
          { name: 'Status', value: queueEntry.productionStatusLabel || 'Aguardando início', inline: true }
        )
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`project_support:${queueEntry.channelId}`)
          .setLabel('Chame suporte')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`contract_end:${queueEntry.channelId}`)
          .setLabel('Encerrar contrato')
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

const projectStatusLabels = {
  started: 'Produção iniciada',
  development: 'Em desenvolvimento',
  testing: 'Em teste',
  configuration: 'Em configuração',
  finished: 'Bot finalizado'
};

const projectStatusSteps = ['started', 'development', 'testing', 'configuration', 'finished'];

function nextProjectStatus(currentStatus = null) {
  if (!currentStatus) return 'started';
  const index = projectStatusSteps.indexOf(currentStatus);
  if (index === -1 || index >= projectStatusSteps.length - 1) return null;
  return projectStatusSteps[index + 1];
}

function buildProjectStatusPanel(queueEntry) {
  const nextStatus = nextProjectStatus(queueEntry.productionStatus);
  const components = nextStatus
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`project_status:${queueEntry.channelId}:${nextStatus}`)
            .setLabel(nextStatus === 'started' ? 'Iniciar produção' : projectStatusLabels[nextStatus])
            .setStyle(nextStatus === 'finished' ? ButtonStyle.Success : ButtonStyle.Primary)
        )
      ]
    : [];

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Andamento do bot')
        .setDescription(nextStatus ? 'A equipe usa o botão abaixo para avançar para a próxima etapa.' : 'Todas as etapas de produção foram concluídas.')
        .addFields(
          { name: 'Projeto', value: queueEntry.projectName || 'não informado', inline: true },
          { name: 'Status atual', value: queueEntry.productionStatusLabel || 'Aguardando início', inline: true },
          { name: 'Próxima etapa', value: nextStatus ? projectStatusLabels[nextStatus] : 'Concluído', inline: true }
        )
        .setTimestamp()
    ],
    components
  };
}

function isProjectWorkflowPanel(message) {
  if (message.author?.id !== message.client?.user?.id) return false;
  return message.embeds?.some((embed) => [
    'Andamento do bot',
    'Aviso de prazo',
    'Liberar acesso ao projeto',
    '✅ Acesso liberado'
  ].includes(embed?.title));
}

function isProjectSupportPanel(message) {
  if (message.author?.id !== message.client?.user?.id) return false;
  return message.embeds?.some((embed) => embed?.title === 'Suporte');
}

async function clearProjectFinalPanels(channel) {
  if (!channel?.isTextBased()) return 0;

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return 0;

  let removed = 0;
  for (const message of messages.values()) {
    if (message.author?.id === message.client?.user?.id) {
      await message.delete().then(() => {
        removed += 1;
      }).catch(() => null);
    }
  }

  return removed;
}

function buildProjectDeadlinePanel(queueEntry) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Aviso de prazo')
        .setDescription(
          'A administração deve definir o prazo para início do desenvolvimento.\n\n' +
            'Se o desenvolvimento não for iniciado até o prazo informado, o valor poderá ser reembolsado conforme combinado.'
        )
        .addFields(
          { name: 'Projeto', value: queueEntry.projectName || 'não informado', inline: true },
          { name: 'Status', value: 'Aguardando prazo do administrador', inline: true }
        )
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`project_deadline:${queueEntry.channelId}`)
          .setLabel('Definir prazo')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

function buildSystemPanelEmbed(guild) {
  const setup = resolveGuildSetup(guild);
  const settings = getSystemSettings(guild.id);
  const boostPercent = getBoostDiscountPercent(settings);
  const clients = listClients(guild.id, null);
  const dashboardAllowed = listDashboardAccess(guild.id, true).length;
  const dashboardPending = listDashboardVerificationCodes(guild.id, 'pending')
    .filter((entry) => !entry.expiresAt || Date.now() <= new Date(entry.expiresAt).getTime())
    .length;
  const hostingPending = clients.filter((client) => client.hostingPaymentStatus === 'awaiting_review').length;
  const hostingSuspended = clients.filter((client) => client.hostingStatus === 'suspended').length;
  const hostingDeleted = clients.filter((client) => client.hostingStatus === 'deleted').length;
  const hostingList = clients
    .filter((client) => client.projectName || client.userTag)
    .slice(0, 10)
    .map((client) => {
      const due = client.hostingDueAt ? new Date(client.hostingDueAt).toLocaleDateString('pt-BR') : 'sem vencimento';
      return `• ${client.userTag || client.userId} | ${client.projectName || 'projeto'} | ${client.hostingStatus || client.status || 'sem status'} | ${due}`;
    })
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Painel de controle do sistema')
    .setDescription('Use os botões abaixo para ajustar preços, promoções e publicar novamente os painéis do sistema.')
    .addFields(
      {
        name: 'Preços atuais',
        value:
          `Básico: **${brl(settings.prices.basic)}**\n` +
          `Premium: **${brl(settings.prices.premium)}**\n` +
          `Hospedagem: **${brl(settings.prices.hosting)}/mês**`,
        inline: false
      },
      {
        name: 'Promoção',
        value: settings.retail.active ? 'Ativa' : 'Desativada',
        inline: true
      },
      {
        name: 'Cargo de verificação',
        value: process.env.FUTURE_CLIENT_ROLE_ID || setup?.roles?.futureClient || 'não configurado',
        inline: true
      },
      {
        name: 'Cargo de não verificado',
        value: process.env.UNVERIFIED_ROLE_ID || setup?.roles?.unverified || 'não configurado',
        inline: true
      },
      {
        name: 'Logs de contrato',
        value: process.env.CONTRACT_LOG_CHANNEL_ID || 'não configurado',
        inline: true
      },
      {
        name: 'Logs gerais',
        value: setup?.channels?.generalLogs ? `<#${setup.channels.generalLogs}>` : 'não configurado',
        inline: true
      },
      {
        name: 'Cupom ativo',
        value:
          settings.coupon?.active && settings.coupon?.code
            ? `\`${settings.coupon.code}\` - ${settings.coupon.percent}% OFF`
            : 'nenhum',
        inline: true
      },
      {
        name: 'Desconto de boost',
        value: boostPercent > 0 ? `${boostPercent}% OFF só para booster ativo` : 'desativado',
        inline: true
      },
      {
        name: 'Pagamento',
        value:
          `Modo: **${paymentModeLabel(settings.payment?.mode)}**\n` +
          `Chave Pix: **${settings.payment?.pixKey ? 'cadastrada' : 'não cadastrada'}**\n` +
          `QR Code: **${settings.payment?.qrCodeText || settings.payment?.qrCodeImageUrl ? 'cadastrado' : 'não cadastrado'}**`,
        inline: false
      },
      {
        name: 'Hospedagem',
        value:
          `Pendentes: **${hostingPending}**\n` +
          `Suspensos: **${hostingSuspended}**\n` +
          `Excluídos: **${hostingDeleted}**`,
        inline: false
      },
      {
        name: 'Dashboard',
        value:
          `Acessos liberados: **${dashboardAllowed}**\n` +
          `Códigos pendentes: **${dashboardPending}**`,
        inline: false
      },
      {
        name: 'Clientes registrados',
        value: hostingList || 'Nenhum cliente registrado.',
        inline: false
      }
    )
    .setFooter({ text: 'As alterações são salvas no banco local do bot.' })
    .setTimestamp();

  return embed;
}

function buildSystemPanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('panel_tools')
        .setPlaceholder('Selecione uma ferramenta do painel')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          { label: 'Editar Básico', value: 'panel_price_basic', description: 'Alterar o valor do plano Básico.' },
          { label: 'Editar Premium', value: 'panel_price_premium', description: 'Alterar o valor do plano Premium.' },
          { label: 'Editar Hospedagem', value: 'panel_price_hosting', description: 'Alterar o valor mensal da hospedagem.' },
          { label: 'Cadastrar Cupom', value: 'panel_coupon_create', description: 'Criar ou atualizar o cupom ativo.' },
          { label: 'Remover Cupom', value: 'panel_coupon_clear', description: 'Desativar o cupom atual.' },
          { label: 'Desconto do Boost', value: 'panel_boost_discount', description: 'Alterar o percentual para boosters.' },
          { label: 'Modo de Pagamento', value: 'panel_payment_mode', description: 'Escolher PagBank, QR Code ou chave Pix.' },
          { label: 'Cadastrar QR Pix', value: 'panel_pix_qr_create', description: 'Salvar imagem e código copia e cola.' },
          { label: 'Upload QR Pix', value: 'panel_pix_qr_upload', description: 'Enviar imagem do QR Code no canal.' },
          { label: 'Cadastrar Chave Pix', value: 'panel_pix_key_create', description: 'Salvar chave Pix manual.' },
          { label: 'Verificar Site', value: 'panel_site_verify', description: 'Gerar código para liberar login na dashboard.' },
          { label: 'Mudar Plano do Usuário', value: 'panel_plan_change', description: 'Alterar o plano registrado de um cliente.' },
          { label: 'Hospedagem paga', value: 'panel_hosting_paid', description: 'Marcar hospedagem de cliente como paga.' },
          { label: 'Hospedagem vencida', value: 'panel_hosting_unpaid', description: 'Marcar hospedagem de cliente como vencida.' },
          { label: 'Ativar/Desativar Promoção', value: 'panel_toggle_promo', description: 'Alternar o status da promoção.' },
          { label: 'Republicar Painéis', value: 'panel_refresh_sales', description: 'Atualizar painéis com os valores atuais.' },
          { label: 'Apagar cadastro', value: 'panel_client_delete', description: 'Remover o cadastro de um cliente.' }
        )
    )
  ];
}

function buildVipPromotionEmbed(settings) {
  const coupon = settings?.coupon?.active && settings?.coupon?.code ? settings.coupon : null;
  const promotionActive = Boolean(settings?.retail?.active);
  const boostPercent = getBoostDiscountPercent(settings);

  return new EmbedBuilder()
    .setColor(coupon || promotionActive ? colors.purple : colors.gray)
    .setTitle(coupon || promotionActive ? '💎 Promoção VIP ativa' : '💎 Promoção VIP')
    .setDescription(
      coupon
        ? `O sistema de cupom está ativo.\n\nUse o cupom **\`${coupon.code}\`** para receber **${coupon.percent}% OFF**.`
        : 'No momento não há cupom ativo para exibir neste canal.'
    )
    .addFields(
      { name: 'Desconto de boost', value: boostPercent > 0 ? `${boostPercent}% OFF enquanto o boost estiver ativo.` : 'Desativado.', inline: true },
      { name: 'Cupom', value: coupon ? `\`${coupon.code}\`` : 'Nenhum', inline: true },
      { name: 'Porcentagem do cupom', value: coupon ? `${coupon.percent}% OFF` : '0%', inline: true }
    )
    .setFooter({ text: 'O desconto final é calculado no contrato conforme os benefícios ativos.' })
    .setTimestamp();
}

function buildTicketReasonModal(type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_reason:${type}`)
    .setTitle(ticketLabels[type] || 'Abrir ticket');

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Motivo do ticket')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000)
    .setPlaceholder('Descreva o que você precisa para a equipe entender seu atendimento.');

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  return modal;
}

function buildPriceModal(customId, label, value) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(`Editar ${label}`);
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(`Novo valor de ${label}`)
    .setStyle(TextInputStyle.Short)
    .setValue(String(value))
    .setRequired(true)
    .setMaxLength(12);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildBoostDiscountModal(settings) {
  const modal = new ModalBuilder().setCustomId('panel_boost_discount_submit').setTitle('Desconto do boost');
  const input = new TextInputBuilder()
    .setCustomId('percent')
    .setLabel('Percentual de desconto do boost')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings?.boost?.percent ?? 5))
    .setRequired(true)
    .setMaxLength(3);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildPixQrModal(settings) {
  const modal = new ModalBuilder().setCustomId('panel_pix_qr_submit').setTitle('Cadastrar QR Code Pix');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('qrCodeImageUrl')
      .setLabel('URL da imagem do QR Code')
      .setPlaceholder('Envie a imagem no Discord e cole o link aqui')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(String(settings.payment?.qrCodeImageUrl || '').slice(0, 400))
      .setMaxLength(500)
  ));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('qrCodeText')
      .setLabel('Código Pix copia e cola')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(String(settings.payment?.qrCodeText || '').slice(0, 3900))
      .setMaxLength(4000)
  ));
  return modal;
}

function buildPixKeyModal(settings) {
  const modal = new ModalBuilder().setCustomId('panel_pix_key_submit').setTitle('Cadastrar chave Pix');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('pixKey')
      .setLabel('Chave Pix')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(settings.payment?.pixKey || '').slice(0, 100))
      .setMaxLength(120)
  ));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('pixKeyLabel')
      .setLabel('Nome/identificação da chave')
      .setPlaceholder('Ex: Orvitek - Gleisson')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(String(settings.payment?.pixKeyLabel || '').slice(0, 80))
      .setMaxLength(100)
  ));
  return modal;
}

function buildPaymentModeSelect(settings) {
  return privateReply({
    content: 'Selecione o modo de pagamento usado nos tickets de compra.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('panel_payment_mode')
          .setPlaceholder(paymentModeLabel(settings.payment?.mode))
          .addOptions(
            { label: 'PagBank automático', value: 'pagbank', description: 'Cria Pix pela API PagBank.' },
            { label: 'QR Code Pix manual', value: 'qr_code', description: 'Envia o QR Code/copia e cola cadastrado.' },
            { label: 'Chave Pix manual', value: 'pix_key', description: 'Envia a chave Pix cadastrada.' }
          )
      )
    ]
  });
}

async function publishSalesPanels(guild, setup, options = {}) {
  const { includePromotions = true } = options;
  const settings = getSystemSettings(guild.id);
  const planEmbeds = buildPlansEmbeds({ settings });
  const plansChannel = setup?.channels?.plans ? await guild.channels.fetch(setup.channels.plans).catch(() => null) : null;
  const promotionsChannel = setup?.channels?.promotions ? await guild.channels.fetch(setup.channels.promotions).catch(() => null) : null;
  const buyNowChannel = setup?.channels?.buyNow ? await guild.channels.fetch(setup.channels.buyNow).catch(() => null) : null;
  const vipOnlyChannel = setup?.channels?.vipOnly ? await guild.channels.fetch(setup.channels.vipOnly).catch(() => null) : null;

  if (plansChannel?.isTextBased()) {
    await replaceStaticPanelMessage(plansChannel, buildPlanSelectionPanelPayload());
  }

  if (includePromotions && promotionsChannel?.isTextBased()) {
    await replaceStaticPanelMessage(promotionsChannel, {
      embeds: [buildPromotionEmbed(settings.retail.active)]
    });
  }

  if (buyNowChannel?.isTextBased()) {
    await replaceStaticPanelMessage(buyNowChannel, {
      embeds: [planEmbeds[0]],
      components: buildPlansButtons()
    }).catch(() => null);
  }

  if (vipOnlyChannel?.isTextBased()) {
    await replaceStaticPanelMessage(vipOnlyChannel, {
      embeds: [buildVipPromotionEmbed(settings)]
    }).catch(() => null);
  }
}

async function replaceConfiguredPanel(guild, channelId, payload) {
  if (!channelId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  await replaceStaticPanelMessage(channel, payload).catch(() => null);
  return true;
}

async function publishAllConfiguredPanels(guild, setup) {
  const settings = getSystemSettings(guild.id);
  let published = 0;

  if (await replaceConfiguredPanel(guild, setup.channels?.verify, buildVerificationPanel())) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.rules, { embeds: buildServerRulesEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.howItWorks, { embeds: buildHowItWorksEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.supportRules, { embeds: buildSupportRulesEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.plans, buildPlanSelectionPanelPayload())) published += 1;
  if (
    await replaceConfiguredPanel(guild, setup.channels?.buyNow, {
      embeds: [buildPlansEmbeds({ settings })[0]],
      components: buildPlansButtons()
    })
  ) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.promotions, { embeds: [buildPromotionEmbed(settings.retail.active)] })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.vipOnly, { embeds: [buildVipPromotionEmbed(settings)] })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.openTicket, buildTicketPanelPayload())) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.renewPlan, buildRenewPanelPayload())) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.suggestions, buildSuggestionsPanelPayload())) published += 1;
  return published;
}

function buildTicketActions(type, contractSigned = false, couponAvailable = false) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('✅ Assumir').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_escalate').setLabel('Escalar').setStyle(ButtonStyle.Secondary)
    )
  ];

  if (purchaseTypes(type)) {
    if (!contractSigned) {
      rows.push(...buildContractButton());
      if (couponAvailable) {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('coupon_apply').setLabel('Tenho cupom').setStyle(ButtonStyle.Primary)
          )
        );
      }
    } else {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('hosting_access_create').setLabel('Criar chave de acesso').setStyle(ButtonStyle.Primary)
        )
      );
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('queue_join').setLabel('Gerar pagamento Pix').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('payment_check').setLabel('Verificar PagBank').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('queue_approve').setLabel('Aprovar na fila').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('queue_development').setLabel('Desenvolvimento').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('queue_ready').setLabel('Bot pronto').setStyle(ButtonStyle.Success)
        )
      );
    }
  }

  return rows;
}

async function handleSetupButton(interaction) {
  const [action, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId && !isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem executou o comando ou quem tem o cargo Dono pode responder esta confirmação.'));
    return true;
  }

  if (action === 'setup_cancel') {
    await safeUpdate(interaction, { content: 'Configuração cancelada.', embeds: [], components: [] });
    return true;
  }

  const updated = await safeUpdate(interaction, {
    content: 'Configurando o servidor. Isso pode levar alguns instantes...',
    embeds: [],
    components: []
  });
  if (!updated) return true;
  await runSetup(interaction);
  return true;
}

async function handleSystemPanelButton(interaction, setup, selectedTool = interaction.customId) {
  const settings = getSystemSettings(interaction.guild.id);

  if (selectedTool === 'panel_toggle_promo') {
    const active = !settings.retail.active;
    updateSystemSettings(interaction.guild.id, {
      retail: {
        active,
        updatedBy: interaction.user.id,
        updatedAt: new Date().toISOString()
      }
    });
    await publishSalesPanels(interaction.guild, setup, { includePromotions: false });
    if (active) {
      const roleId = process.env.PROMOTION_ROLE_ID || '1505184193766752386';
      const promotionsChannel = setup?.channels?.promotions ? await interaction.guild.channels.fetch(setup.channels.promotions).catch(() => null) : null;
      if (promotionsChannel?.isTextBased()) {
        await promotionsChannel.send(toComponentsV2({
          content: `<@&${roleId}>`,
          allowedMentions: { roles: [roleId] },
          embeds: [buildPromotionEmbed(true)]
        })).catch(() => null);
      }
    }
    await safeReply(
      interaction,
      privateReply(active ? 'Promoção ativada no painel de controle.' : 'Promoção desativada no painel de controle.')
    );
    return true;
  }

  if (selectedTool === 'panel_refresh_sales') {
    const published = await publishAllConfiguredPanels(interaction.guild, setup);
    await safeReply(interaction, privateReply(`Painéis republicados: ${published}.`));
    return true;
  }

  if (selectedTool === 'panel_coupon_clear') {
    await handleCouponClear(interaction, setup);
    return true;
  }

  if (selectedTool === 'panel_payment_mode') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode alterar o modo de pagamento.'));
      return true;
    }

    await safeReply(interaction, buildPaymentModeSelect(settings));
    return true;
  }

  if (selectedTool === 'panel_pix_qr_upload') {
    await handlePixQrUpload(interaction);
    return true;
  }

  if (selectedTool === 'panel_site_verify') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode gerar código da dashboard.'));
      return true;
    }

    await safeReply(interaction, buildDashboardVerificationUserSelectPayload());
    return true;
  }

  if (selectedTool === 'panel_plan_change') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode mudar o plano de um usuário.'));
      return true;
    }

    await safeReply(interaction, buildHostingUserSelectPayload('panel_plan_user', 'Mudar plano do usuário'));
    return true;
  }

  if (selectedTool === 'panel_hosting_paid') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode usar este controle.'));
      return true;
    }

    await safeReply(interaction, buildHostingUserSelectPayload('panel_hosting_paid_user', 'Marcar hospedagem como paga'));
    return true;
  }

  if (selectedTool === 'panel_hosting_unpaid') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode usar este controle.'));
      return true;
    }

    await safeReply(interaction, buildHostingUserSelectPayload('panel_hosting_unpaid_user', 'Marcar hospedagem como vencida'));
    return true;
  }

  if (selectedTool === 'panel_client_delete') {
    if (!isOwnerRole(interaction.member)) {
      await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode apagar cadastros.'));
      return true;
    }

    await safeReply(interaction, buildHostingUserSelectPayload('panel_client_delete_user', 'Apagar cadastro do usuário'));
    return true;
  }

  const modalMap = {
    panel_price_basic: buildPriceModal('panel_price_basic_submit', 'Plano Básico', settings.prices.basic),
    panel_price_premium: buildPriceModal('panel_price_premium_submit', 'Plano Premium', settings.prices.premium),
    panel_price_hosting: buildPriceModal('panel_price_hosting_submit', 'Hospedagem', settings.prices.hosting),
    panel_coupon_create: buildCouponModal(settings.coupon),
    panel_boost_discount: buildBoostDiscountModal(settings),
    panel_pix_qr_create: buildPixQrModal(settings),
    panel_pix_key_create: buildPixKeyModal(settings)
  };

  const modal = modalMap[selectedTool];
  if (modal) {
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

function buildCouponModal(currentCoupon) {
  const modal = new ModalBuilder().setCustomId('panel_coupon_create_submit').setTitle('Cadastrar Cupom');
  const code = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('Código do cupom')
    .setStyle(TextInputStyle.Short)
    .setValue(String(currentCoupon?.code || ''))
    .setRequired(true)
    .setMaxLength(20);
  const percent = new TextInputBuilder()
    .setCustomId('percent')
    .setLabel('Percentual de desconto')
    .setStyle(TextInputStyle.Short)
    .setValue(String(currentCoupon?.percent || 10))
    .setRequired(true)
    .setMaxLength(3);

  modal.addComponents(new ActionRowBuilder().addComponents(code));
  modal.addComponents(new ActionRowBuilder().addComponents(percent));
  return modal;
}

function buildHostingActionModal(customId, title) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const user = new TextInputBuilder()
    .setCustomId('user')
    .setLabel('Usuário ou ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  const channel = new TextInputBuilder()
    .setCustomId('channel')
    .setLabel('Canal do projeto')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  modal.addComponents(new ActionRowBuilder().addComponents(user));
  modal.addComponents(new ActionRowBuilder().addComponents(channel));
  return modal;
}

function buildHostingUserSelectPayload(customId, title) {
  return privateReply({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle(title)
        .setDescription('Selecione o cliente abaixo. O bot vai localizar o registro dele no sistema automaticamente.')
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder('Selecione o cliente')
          .setMinValues(1)
          .setMaxValues(1)
      )
    ]
  });
}

function buildDashboardVerificationUserSelectPayload() {
  return privateReply({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Verificar Site')
        .setDescription('Selecione o usuário que vai receber o código para liberar o acesso na dashboard.')
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('panel_site_verify_user')
          .setPlaceholder('Selecione o usuário')
          .setMinValues(1)
          .setMaxValues(1)
      )
    ]
  });
}

function buildClientPlanSelectPayload(userId, clientRecord) {
  return privateReply({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Mudar plano do usuário')
        .setDescription(`Cliente: <@${userId}>\nPlano atual: **${planLabel(clientRecord?.plan)}**`)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`panel_plan_select:${userId}`)
          .setPlaceholder('Selecione o novo plano')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            { label: 'Plano Básico', value: 'basico', description: 'Remove cargos do plano Premium.' },
            { label: 'Plano Premium', value: 'premium', description: 'Adiciona cargos Plano Pro e Cliente VIP.' },
            { label: 'Plano Vitalício', value: 'vitalicio', description: 'Registra o cliente como vitalício.' }
          )
      )
    ]
  });
}

function buildHostingAccessCreateModal() {
  const modal = new ModalBuilder().setCustomId('hosting_access_create_submit').setTitle('Criar chave de acesso');
  const botName = new TextInputBuilder()
    .setCustomId('botName')
    .setLabel('Nome do bot/projeto')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const password = new TextInputBuilder()
    .setCustomId('password')
    .setLabel('Senha de acesso')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(64);
  const confirmPassword = new TextInputBuilder()
    .setCustomId('confirmPassword')
    .setLabel('Confirmar senha')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(botName));
  modal.addComponents(new ActionRowBuilder().addComponents(password));
  modal.addComponents(new ActionRowBuilder().addComponents(confirmPassword));
  return modal;
}

async function logHostingEvent(guild, embed) {
  const channelId = HOSTING_LOG_CHANNEL_ID;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(toComponentsV2({ embeds: [embed] })).catch(() => null);
  }
}

function findClientByAccessKey(guildId, accessKey) {
  const normalized = String(accessKey || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return listClients(guildId, null).find((client) => String(client.accessKey || '').trim().toLowerCase() === normalized) || null;
}

function isGraceExpired(clientRecord, now = new Date()) {
  if (!clientRecord?.hostingGraceUntil) {
    return false;
  }

  return now.getTime() >= new Date(clientRecord.hostingGraceUntil).getTime();
}

async function revokeHostingAccess(guild, clientRecord, options = {}) {
  const channel = clientRecord.projectChannelId ? await guild.channels.fetch(clientRecord.projectChannelId).catch(() => null) : null;
  const member = await guild.members.fetch(clientRecord.userId).catch(() => null);

  if (channel?.isTextBased() && member) {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false
    }).catch(() => null);
  }

  upsertClient(guild.id, clientRecord.userId, {
    hostingStatus: 'suspended',
    accessGranted: false,
    hostingPaymentStatus: 'overdue',
    hostingRevokedAt: new Date().toISOString(),
    hostingRevokedBy: options.byUserId || null,
    hostingReminderMessageId: clientRecord.hostingReminderMessageId || null,
    hostingGraceUntil: clientRecord.hostingGraceUntil || (clientRecord.hostingDueAt ? getHostingGraceDeadline(new Date(clientRecord.hostingDueAt)).toISOString() : null)
  });

  if (member?.user) {
    await member.user.send(toComponentsV2({
      embeds: [buildHostingOverdueDm({ guildName: guild.name, projectName: clientRecord.projectName })]
    })).catch(() => null);
  }

  await logHostingEvent(
    guild,
    new EmbedBuilder()
      .setColor(colors.red)
      .setTitle('Hospedagem revogada')
      .addFields(
        { name: 'Cliente', value: clientRecord.userTag || clientRecord.userId, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
        { name: 'Motivo', value: options.reason || 'não informado', inline: true }
      )
      .setTimestamp()
  );
}

async function deleteHostingAccess(guild, clientRecord, options = {}) {
  const channel = clientRecord.projectChannelId ? await guild.channels.fetch(clientRecord.projectChannelId).catch(() => null) : null;
  const ticketChannel = clientRecord.paymentTicketChannelId ? await guild.channels.fetch(clientRecord.paymentTicketChannelId).catch(() => null) : null;
  const member = await guild.members.fetch(clientRecord.userId).catch(() => null);
  const reason = options.reason || 'O prazo de tolerância da hospedagem terminou.';
  const endedAt = new Date().toISOString();
  const queueEntry = findClientQueueEntry(guild.id, clientRecord.userId, clientRecord);
  const queueChannelId = queueEntry?.channelId || clientRecord.paymentTicketChannelId || clientRecord.projectChannelId;

  if (ticketChannel?.deletable && ticketChannel.id !== channel?.id) {
    await ticketChannel.delete(reason).catch(() => null);
  }

  if (queueChannelId) {
    upsertQueueEntry(queueChannelId, {
      guildId: guild.id,
      ownerId: clientRecord.userId,
      ownerTag: clientRecord.userTag || queueEntry?.ownerTag || clientRecord.userId,
      plan: clientRecord.plan || queueEntry?.plan || null,
      projectName: clientRecord.projectName || queueEntry?.projectName || null,
      projectChannelId: clientRecord.projectChannelId || queueEntry?.projectChannelId || null,
      status: 'contract_ended',
      contractEndedAt: endedAt,
      contractEndedBy: options.byUserId || null,
      contractEndReason: reason,
      hostingStatus: 'deleted',
      hostingPaymentStatus: 'cancelled',
      accessGranted: false,
      accessKey: null,
      accessPasswordHash: null,
      accessPasswordSalt: null,
      tempPasswordHash: null,
      tempPasswordSalt: null,
      tempPasswordExpiresAt: null,
      hostingDeletedAt: endedAt,
      hostingDeletedBy: options.byUserId || null,
      paymentRejectDeleteAt: null
    });
  }

  upsertClient(guild.id, clientRecord.userId, {
    status: 'contract_ended',
    hostingStatus: 'deleted',
    hostingPaymentStatus: 'cancelled',
    accessGranted: false,
    accessKey: null,
    accessPasswordHash: null,
    accessPasswordSalt: null,
    hostingDeletedAt: endedAt,
    hostingDeletedBy: options.byUserId || null,
    contractEndedAt: endedAt,
    contractEndedBy: options.byUserId || null,
    contractEndReason: reason,
    hostingReminderMessageId: null,
    paymentTicketChannelId: null,
    paymentRejectDeleteAt: null
  });

  const setup = resolveGuildSetup(guild) || {};
  if (member) {
    await removeConfiguredRole(member, setup, 'queue', 'Na Fila');
    await removeConfiguredRole(member, setup, 'development', 'Bot em Desenvolvimento');
    await removeConfiguredRole(member, setup, 'delivered', 'Bot Entregue');
    await removeConfiguredRole(member, setup, 'active', 'Cliente Ativo');
    await removeConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    await removeConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
    await addConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  }

  const projectChannelCanBeDeleted = Boolean(channel?.deletable);
  if (channel?.isTextBased()) {
    if (!projectChannelCanBeDeleted) {
      const targetCategory = await guild.channels.fetch(DELIVERED_PROJECT_CATEGORY_ID).catch(() => null);
      if (targetCategory?.type === ChannelType.GuildCategory) {
        await channel.setParent(targetCategory.id, { lockPermissions: false }).catch(() => null);
      }
    }

    await clearProjectFinalPanels(channel);
    await channel.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('Contrato encerrado automaticamente')
          .setDescription(
            'Este contrato foi encerrado por falta de pagamento da hospedagem.' +
              (projectChannelCanBeDeleted ? '\n\nEste canal será apagado em 5 segundos.' : '')
          )
          .addFields(
            { name: 'Cliente', value: `<@${clientRecord.userId}>`, inline: true },
            { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
            { name: 'Motivo', value: reason.slice(0, 1000) }
          )
          .setTimestamp()
      ]
    })).catch(() => null);

    if (!projectChannelCanBeDeleted) {
      await channel.send(toComponentsV2(buildProjectSupportPanel({
        ...(queueEntry || {}),
        channelId: queueChannelId || channel.id,
        ownerId: clientRecord.userId,
        projectName: clientRecord.projectName || queueEntry?.projectName || 'não informado',
        projectChannelId: channel.id,
        productionStatusLabel: 'Contrato encerrado'
      }))).catch(() => null);
    }
  }

  const projectChannelDeleteScheduled = projectChannelCanBeDeleted
    ? scheduleChannelDeletion(channel, auditLogReason('Contrato encerrado por hospedagem', reason))
    : false;
  if (projectChannelDeleteScheduled) {
    if (queueChannelId) {
      upsertQueueEntry(queueChannelId, {
        projectChannelDeleteScheduledAt: endedAt,
        projectChannelDeleteScheduledBy: options.byUserId || null
      });
    }
    upsertClient(guild.id, clientRecord.userId, {
      projectChannelDeleteScheduledAt: endedAt,
      projectChannelDeleteScheduledBy: options.byUserId || null
    });
  }

  if (member?.user) {
    await member.user.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('Contrato encerrado')
          .setDescription(
            `${reason} Projeto: **${clientRecord.projectName || 'seu projeto'}**.\n\n` +
              'Sua chave foi excluída do sistema. Para regularizar ou contratar novamente, chame o suporte.'
          )
      ]
    })).catch(() => null);
  }

  await logHostingEvent(
    guild,
    new EmbedBuilder()
      .setColor(colors.red)
      .setTitle('Contrato encerrado por hospedagem')
      .addFields(
        { name: 'Cliente', value: clientRecord.userTag || clientRecord.userId, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
        { name: 'Vencimento', value: clientRecord.hostingDueAt || 'não informado', inline: true },
        { name: 'Encerramento', value: endedAt, inline: true },
        { name: 'Motivo', value: reason.slice(0, 1000) }
      )
      .setTimestamp()
  );
}

async function restoreHostingAccess(guild, clientRecord, options = {}) {
  if (!clientRecord.accessKey || (!clientRecord.accessPasswordHash && !clientRecord.accessPassword)) {
    return { ok: false, reason: 'Chave de acesso removida. O cliente precisa refazer o fluxo.' };
  }

  const channel = clientRecord.projectChannelId ? await guild.channels.fetch(clientRecord.projectChannelId).catch(() => null) : null;
  const member = await guild.members.fetch(clientRecord.userId).catch(() => null);
  if (!channel?.isTextBased() || !member) {
    return { ok: false, reason: 'Canal ou membro não encontrado.' };
  }

  await channel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  }).catch(() => null);

  const dueAt = getNextHostingDueDate();
  const cycle = getHostingCycleKey(dueAt);
  upsertClient(guild.id, clientRecord.userId, {
    hostingStatus: 'current',
    accessGranted: true,
    hostingCycle: cycle,
    hostingDueAt: dueAt.toISOString(),
    hostingGraceUntil: getHostingGraceDeadline(dueAt).toISOString(),
    hostingReminderCycle: null,
    hostingPaymentStatus: 'paid',
    hostingPaidAt: new Date().toISOString(),
    hostingPaidBy: options.byUserId || null
  });

  if (member?.user) {
    await sendDmPanel(
      member.user,
      buildAccessUnlockedDm({
        guildName: guild.name,
        projectName: clientRecord.projectName,
        channelName: `<#${clientRecord.projectChannelId}>`
      })
    );
  }

  await logHostingEvent(
    guild,
    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Hospedagem regularizada')
      .addFields(
        { name: 'Cliente', value: clientRecord.userTag || clientRecord.userId, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
        { name: 'Próximo vencimento', value: dueAt.toISOString(), inline: true }
      )
      .setTimestamp()
  );

  return { ok: true, dueAt };
}

async function publishHostingReminder(guild, clientRecord) {
  const channel = clientRecord.projectChannelId ? await guild.channels.fetch(clientRecord.projectChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) {
    return false;
  }

  const dueAt = clientRecord.hostingDueAt ? new Date(clientRecord.hostingDueAt) : getNextHostingDueDate();
  const panel = buildHostingBillingPanel({
    guildName: guild.name,
    projectName: clientRecord.projectName,
    dueAt: dueAt.toLocaleDateString('pt-BR'),
    channelId: clientRecord.projectChannelId
  });

  const previousId = clientRecord.hostingReminderMessageId;
  if (previousId) {
    await channel.messages.delete(previousId).catch(() => null);
  }

  const message = await channel.send(toComponentsV2(panel)).catch(() => null);
  if (message) {
    upsertClient(guild.id, clientRecord.userId, {
      hostingReminderMessageId: message.id,
      hostingReminderCycle: getHostingCycleKey(dueAt),
      hostingLastReminderAt: new Date().toISOString()
    });
  }

  return true;
}

async function ensureProjectChannel(guild, setup, user, projectName) {
  const channelName = getProjectChannelName(projectName, user.username);
  const categoryName = getProjectCategoryName(projectName, user.username);
  let category = guild.channels.cache.find((entry) => entry.name === categoryName && entry.type === ChannelType.GuildCategory);
  if (!category) {
    const everyoneRoleId = guild.roles.everyone?.id || guild.id;
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        ...staffOverwrites(guild, setup)
      ],
      reason: `Categoria de projeto criada para ${user.tag}`
    }).catch(() => null);
  }

  let channel = guild.channels.cache.find((entry) => entry.name === channelName && entry.type === ChannelType.GuildText);

  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id || PROJECT_ACCESS_CATEGORY_ID || setup.categories.customers || null,
      permissionOverwrites: projectChannelOverwrites(guild, setup, user.id, false),
      reason: `Canal de projeto criado para ${user.tag}`
    });

    await replacePanelMessage(channel, {
      embeds: [
        new EmbedBuilder()
          .setColor(colors.default)
          .setTitle('Canal do projeto criado')
          .setDescription(
            `O espaço do projeto **${projectName}** foi criado para o cliente **${user.tag}**.\n\n` +
              'O acesso do cliente será liberado após ele informar a chave de acesso e a senha recebidas na DM.'
          )
          .addFields(
            { name: 'Cliente', value: user.tag, inline: true },
            { name: 'Projeto', value: projectName || 'não informado', inline: true },
            { name: 'Status', value: 'Aguardando desbloqueio', inline: true }
          )
          .setTimestamp()
      ]
    }).catch(() => null);
  }

  return channel;
}

async function verifyMember(interaction, setup) {
  const unverifiedCandidates = [process.env.UNVERIFIED_ROLE_ID, setup?.roles?.unverified, '1505626948951347221'];
  const futureClientCandidates = [process.env.FUTURE_CLIENT_ROLE_ID, setup?.roles?.futureClient, '1505626950356566056'];
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

  try {
    const role = await resolveRole(interaction.guild, futureClientCandidates, 'Futuro Cliente');
    if (!role) {
      console.warn(`Falha ao verificar ${interaction.user.tag}: cargo Futuro Cliente não configurado.`);
      await safeReply(interaction, privateReply('⚠️ O cargo de verificação não está configurado. Por favor, entre em contato com um administrador.'));
      return;
    }

    if (!botMember || !role.editable) {
      console.warn(`Falha ao verificar ${interaction.user.tag}: bot sem permissão/hierarquia para adicionar o cargo ${role.name} (${role.id}).`);
      await safeReply(interaction, privateReply('⚠️ Não consegui liberar seu acesso porque o cargo de verificação está acima do cargo do bot ou falta permissão. Por favor, entre em contato com um administrador.'));
      return;
    }

    const unverifiedRole = await resolveRole(interaction.guild, unverifiedCandidates, 'Não Verificado');
    if (unverifiedRole && interaction.member.roles.cache.has(unverifiedRole.id)) {
      if (!unverifiedRole.editable) {
        console.warn(`Falha ao remover cargo de não verificado de ${interaction.user.tag}: bot sem permissão/hierarquia para ${unverifiedRole.name} (${unverifiedRole.id}).`);
      } else {
        await interaction.member.roles.remove(unverifiedRole);
      }
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      await interaction.member.roles.add(role);
    }

    const dmSent = await sendDmPanel(interaction.user, buildVerificationSuccessDm(interaction.guild.name));
    await safeReply(
      interaction,
      privateReply(
        dmSent
          ? 'Verificação concluída! Enviei uma mensagem no seu privado.'
          : 'Verificação concluída! Não consegui enviar DM, mas seu acesso foi liberado.'
      )
    );
  } catch (error) {
    console.warn(`Falha ao verificar ${interaction.user.tag}: ${error.message}`);
    await safeReply(interaction, privateReply('⚠️ Ocorreu um erro ao processar sua verificação. Por favor, entre em contato com um administrador.'));
  }
}

async function openTicket(interaction, setup, type, reason = null) {
  const settings = getSystemSettings(interaction.guild.id);
  const slug = ticketSlugs[type] || 'suporte';
  const username = channelSafe(interaction.user.username);
  const existing = interaction.guild.channels.cache.find(
    (channel) => channel.name.includes(username) && channel.name.startsWith('suporte-') && channel.type === ChannelType.GuildText
  );

  if (existing) {
    await interaction.reply(privateReply(`Você já tem um ticket aberto: ${existing}`));
    return;
  }

  if (purchaseTypes(type)) {
    const clientRecord = getClient(interaction.guild.id, interaction.user.id);
    if (isBlockingContractRecord(clientRecord)) {
      await interaction.reply(privateReply(
        `Você já tem um contrato ativo registrado para **${clientRecord.projectName || planLabel(clientRecord.plan)}**.\n` +
          'Para trocar de plano ou encerrar o contrato atual, chame o suporte.'
      ));
      return;
    }
  }

  const supportCategoryId = setup.categories.supportCategory;
  const everyoneRoleId = interaction.guild.roles.everyone?.id || interaction.guild.id;
  const channel = await interaction.guild.channels.create({
    name: `suporte-${slug}-${username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: supportCategoryId || null,
    permissionOverwrites: [
      { id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...staffOverwrites(interaction.guild, setup)
    ],
    reason: `Ticket aberto por ${interaction.user.tag}`
  });

  const ticket = createTicket({
    guildId: interaction.guild.id,
    channelId: channel.id,
    ownerId: interaction.user.id,
    ownerTag: interaction.user.tag,
    type
  });
  const hostingClient = getClient(interaction.guild.id, interaction.user.id);

  if (purchaseTypes(type)) {
    upsertQueueEntry(channel.id, {
      guildId: interaction.guild.id,
      ownerId: interaction.user.id,
      ownerTag: interaction.user.tag,
      plan: type === 'plan_pro' ? 'premium' : type === 'plan_basic' ? 'basico' : type === 'plan_lifetime' ? 'vitalicio' : 'comprovante',
      status: 'opened',
      createdAt: new Date().toISOString()
    });
  }

  const ticketMentions = [`<@${interaction.user.id}>`];
  if (TICKET_ALERT_ROLE_ID) {
    ticketMentions.push(`<@&${TICKET_ALERT_ROLE_ID}>`);
  }

  await channel.send(toComponentsV2({
    content: ticketMentions.join(' '),
    allowedMentions: {
      users: [interaction.user.id],
      roles: TICKET_ALERT_ROLE_ID ? [TICKET_ALERT_ROLE_ID] : []
    },
    embeds: [
      (() => {
        const embed = new EmbedBuilder()
        .setColor(colors.blue)
        .setTitle(`Ticket #${ticket.id}`)
        .setDescription(
          `${getTimeGreeting()}, ${interaction.user}.\n\n` +
            'Aguarde nossa equipe te responder.\n\n' +
            (purchaseTypes(type)
              ? 'Primeiro assine o contrato, depois crie a chave de acesso e gere o Pix PagBank neste canal.\n\nA ativação do bot só é feita depois que o PagBank confirmar o pagamento. Para entrar na fila de produção, siga as instruções do atendimento e aguarde a aprovação. Cada bot tem prazo médio de entrega de até 5 dias após aprovação na fila.'
              : 'A equipe irá atender você em breve.')
        )
        .addFields(
          { name: 'Precisa de', value: ticketLabels[type] || type, inline: true },
          { name: 'Cliente', value: interaction.user.tag, inline: true },
          { name: 'Canal', value: `Suporte | ${interaction.user.username}` },
          ...(reason ? [{ name: 'Motivo', value: reason.slice(0, 1000) }] : []),
          ...(purchaseTypes(type)
            ? [
                { name: 'Pagamento', value: 'Pix PagBank gerado aqui no canal.', inline: true },
                { name: 'Entrada na fila', value: 'Após confirmação do pagamento integral.', inline: true },
                { name: 'Prazo médio', value: 'Até 5 dias após aprovação.', inline: true }
              ]
            : [])
        )
        .setTimestamp();

        if (hostingClient?.hostingStatus) {
          embed.addFields(
            { name: 'Status da hospedagem', value: hostingClient.hostingStatus, inline: true },
            {
              name: 'Vencimento',
              value: hostingClient.hostingDueAt ? new Date(hostingClient.hostingDueAt).toLocaleDateString('pt-BR') : 'não informado',
              inline: true
            }
          );
        }

        return embed;
      })()
    ],
    components: purchaseTypes(type) ? [] : buildTicketActions(type, false, Boolean(settings.coupon?.active && settings.coupon?.code))
  }));

  if (purchaseTypes(type)) {
    await channel.send(toComponentsV2({
      embeds: [buildContractIntroEmbed(ticket, settings)],
      components: buildContractOnlyActions()
    }));
  }

  await interaction.reply(privateReply(`Ticket criado: ${channel}`));
}

async function handleTicketAction(interaction, setup) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply(privateReply('Este canal não está registrado como ticket.'));
    return;
  }

  if (!isStaff(interaction.member)) {
    await interaction.reply(privateReply('Apenas a equipe pode usar esta ação.'));
    return;
  }

  if (interaction.customId === 'ticket_claim') {
    updateTicket(interaction.channelId, { claimedBy: interaction.user.id });
    await interaction.reply(toComponentsV2({ content: `Ticket assumido por ${interaction.user}.` }));
    return;
  }

  if (interaction.customId === 'ticket_escalate') {
    const reports = setup.channels.reports ? `<#${setup.channels.reports}>` : 'relatórios';
    await interaction.reply(toComponentsV2({ content: `Ticket escalado para ${reports}.` }));
    return;
  }

  updateTicket(interaction.channelId, { status: 'closed', closedAt: new Date().toISOString() });
  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  if (member) {
    await sendRatingRequest(member.user, ticket.id);
  }
  await interaction.reply(toComponentsV2({ content: 'Ticket fechado. Este canal será removido em 10 segundos.' }));
  setTimeout(() => interaction.channel.delete('Ticket fechado').catch(() => null), 10000);
}

async function approveQueuePayment(interaction, setup, ticket, member, approvedByUserId) {
  const queueEntry = getQueueEntry(interaction.channelId);
  const contract = getContract(interaction.channelId);
  const projectName = queueEntry?.projectName || contract?.projectName || ticket.ownerTag;
  const accessKey = queueEntry?.accessKey;
  const accessPasswordHash = queueEntry?.accessPasswordHash;
  const accessPasswordSalt = queueEntry?.accessPasswordSalt;

  if (queueEntry?.status === 'approved' && queueEntry.projectChannelId) {
    const existingProjectChannel = await interaction.guild.channels.fetch(queueEntry.projectChannelId).catch(() => null);
    return {
      ok: true,
      projectChannel: existingProjectChannel || `<#${queueEntry.projectChannelId}>`,
      position: getQueuePosition(interaction.guild.id, interaction.channelId),
      projectName
    };
  }

  if (!accessKey || !accessPasswordHash || !accessPasswordSalt) {
    return { ok: false, reason: 'O cliente precisa criar a chave de acesso antes da aprovação.' };
  }

  const projectChannel = await ensureProjectChannel(interaction.guild, setup, member.user, projectName);
  const dueAt = getNextHostingDueDate();
  const hostingCycle = getHostingCycleKey(dueAt);
  const plan = ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type;
  const now = new Date().toISOString();

  upsertQueueEntry(interaction.channelId, {
    guildId: interaction.guild.id,
    ownerId: ticket.ownerId,
    ownerTag: ticket.ownerTag,
    plan,
    status: 'approved',
    approvedAt: now,
    approvedBy: approvedByUserId,
    paymentProvider: queueEntry?.paymentProvider || null,
    paymentOrderId: queueEntry?.paymentOrderId || null,
    paymentPaidAt: queueEntry?.paymentPaidAt || now,
    couponCode: queueEntry?.couponCode || null,
    couponPercent: queueEntry?.couponPercent || 0,
    boostDiscountActive: queueEntry?.boostDiscountActive || false,
    boostDiscountPercent: queueEntry?.boostDiscountPercent || 0,
    finalPrice: queueEntry?.finalPrice || null,
    entryPrice: queueEntry?.entryPrice || null,
    projectName,
    projectChannelId: projectChannel.id,
    projectCategoryId: projectChannel.parentId || null,
    accessKey,
    accessPasswordHash,
    accessPasswordSalt,
    accessGranted: false,
    hostingCycle,
    hostingStatus: 'current',
    hostingDueAt: dueAt.toISOString(),
    hostingGraceUntil: getHostingGraceDeadline(dueAt).toISOString(),
    hostingReminderCycle: null,
    hostingPaymentStatus: 'waiting'
  });

  upsertClient(interaction.guild.id, ticket.ownerId, {
    userTag: ticket.ownerTag,
    plan,
    projectName,
    projectChannelId: projectChannel.id,
    projectCategoryId: projectChannel.parentId || null,
    accessKey,
    accessPasswordHash,
    accessPasswordSalt,
    status: 'pending_access',
    hostingCycle,
    hostingStatus: 'current',
    hostingDueAt: dueAt.toISOString(),
    hostingGraceUntil: getHostingGraceDeadline(dueAt).toISOString(),
    hostingReminderCycle: null,
    hostingPaymentStatus: 'waiting',
    paymentProvider: queueEntry?.paymentProvider || null,
    paymentOrderId: queueEntry?.paymentOrderId || null,
    paymentPaidAt: queueEntry?.paymentPaidAt || now,
    couponCode: queueEntry?.couponCode || null,
    couponPercent: queueEntry?.couponPercent || 0,
    boostDiscountActive: queueEntry?.boostDiscountActive || false,
    boostDiscountPercent: queueEntry?.boostDiscountPercent || 0,
    finalPrice: queueEntry?.finalPrice || null,
    entryPrice: queueEntry?.entryPrice || null,
    activatedBy: approvedByUserId
  });

  await removeConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  await addRoleById(member, process.env.APPROVED_CLIENT_ROLE_ID || '1505185447813320724', 'Compra aprovada');
  await applyProjectProgressRoles(member, setup, 'queue');
  const position = getQueuePosition(interaction.guild.id, interaction.channelId);
  const projectPayload = { ...queueEntry, channelId: interaction.channelId, projectName, accessKey, projectChannelId: projectChannel.id };
  await projectChannel.send(toComponentsV2(buildProjectAccessPanel(projectPayload))).catch(() => null);

  const dmPayload = buildAccessApprovalDm({
    guildName: interaction.guild.name,
    projectName,
    accessKey,
    channelId: interaction.channelId,
    projectChannelId: projectChannel.id
  });
  await sendDmPanel(member.user, dmPayload.embed, [], dmPayload.components);
  await sendDmPanel(
    member.user,
    buildPurchaseReceiptEmbed({
      guild: interaction.guild,
      ticket,
      contract,
      queueEntry: getQueueEntry(interaction.channelId),
      payment: getPayment(interaction.channelId),
      approvedByUserId
    })
  );

  return { ok: true, projectChannel, position, projectName };
}

async function handleQueueAction(interaction, setup) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply(privateReply('Este canal não está registrado como atendimento.'));
    return;
  }

  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  if (!member) {
    await interaction.reply(privateReply('Não consegui encontrar o cliente deste canal.'));
    return;
  }

  const signedContract = getContract(interaction.channelId);
  if (!signedContract) {
    await interaction.reply(privateReply('O contrato precisa ser assinado antes de iniciar pagamento, fila ou produção.'));
    return;
  }

  if (interaction.customId === 'queue_join') {
    if (ticket.ownerId !== interaction.user.id) {
      await interaction.reply(privateReply('Apenas o cliente deste atendimento pode se adicionar na fila.'));
      return;
    }

    const queueEntry = getQueueEntry(interaction.channelId);
    if (!queueEntry?.accessKey) {
      await interaction.reply(privateReply('Crie a chave de acesso antes de gerar o pagamento Pix.'));
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const position = getQueuePosition(interaction.guild.id, interaction.channelId);
    const settings = getSystemSettings(interaction.guild.id);
    const resolvedPayment = resolvePurchasePaymentMode(settings);
    const paymentMode = resolvedPayment.mode;
    const paymentSettings = {
      ...settings,
      payment: {
        ...(settings.payment || {}),
        mode: paymentMode || settings.payment?.mode || 'pagbank'
      }
    };
    const currentPricing = getPlanPricing(ticket.type, settings, queueEntry?.couponCode || null, { member });
    const paymentPrice = getEntryPaymentAmount(signedContract);
    const pricing = {
      base: signedContract.basePrice ?? currentPricing.base,
      final: signedContract.finalPrice ?? currentPricing.final,
      payment: paymentPrice,
      couponMatches: Boolean(signedContract.couponCode),
      coupon: { code: signedContract.couponCode, percent: signedContract.couponPercent || 0 },
      boostActive: Boolean(signedContract.boostDiscountActive),
      boostPercent: signedContract.boostDiscountPercent || 0
    };

    let payment = getPayment(interaction.channelId);
    const reusedPayment = paymentIsReusable(payment);

    if (!paymentMode) {
      await interaction.editReply(toComponentsV2('Nenhum pagamento está configurado. Configure o PagBank ou cadastre uma chave Pix/QR Code no /painel.'));
      return;
    }

    if (paymentMode === 'pix_key' || paymentMode === 'qr_code') {
      if (paymentMode === 'pix_key' && !paymentSettings.payment?.pixKey) {
        await interaction.editReply(toComponentsV2('A chave Pix manual ainda não foi cadastrada no /painel.'));
        return;
      }

      if (paymentMode === 'qr_code' && !paymentSettings.payment?.qrCodeText && !paymentSettings.payment?.qrCodeImageUrl) {
        await interaction.editReply(toComponentsV2('O QR Code Pix manual ainda não foi cadastrado no /painel.'));
        return;
      }

      payment = upsertPayment(interaction.channelId, {
        provider: paymentMode,
        referenceId: `manual-${interaction.guild.id}-${interaction.channelId}`,
        orderId: null,
        amountCents: Math.round(pricing.payment * 100),
        status: 'awaiting_manual_approval',
        guildId: interaction.guild.id,
        userId: ticket.ownerId,
        userTag: ticket.ownerTag,
        contractId: signedContract.id,
        projectName: signedContract.projectName,
        plan: ticket.type,
        createdAt: new Date().toISOString()
      });

      upsertQueueEntry(interaction.channelId, {
        guildId: interaction.guild.id,
        ownerId: ticket.ownerId,
        ownerTag: ticket.ownerTag,
        plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
        status: 'awaiting_manual_payment',
        basePrice: pricing.base,
        finalPrice: pricing.final,
        entryPrice: pricing.payment,
        paidPrice: pricing.payment,
        paymentProvider: paymentMode,
        paymentStatus: payment.status,
        paymentAmountCents: payment.amountCents,
        couponCode: pricing.couponMatches ? pricing.coupon.code : null,
        couponPercent: pricing.couponMatches ? pricing.coupon.percent : 0,
        boostDiscountActive: pricing.boostActive,
        boostDiscountPercent: pricing.boostPercent,
        requestedAt: new Date().toISOString()
      });

      await interaction.channel.send(toComponentsV2({
        content:
          `${interaction.user}, pagamento Pix enviado. Clientes na frente no momento: **${position.ahead}**.` +
          (resolvedPayment.fallback ? `\nModo selecionado indisponível; usei **${paymentModeLabel(paymentMode)}**.` : '') +
          (pricing.couponMatches ? `\nCupom aplicado: **${pricing.coupon.code}** (-${pricing.coupon.percent}%).` : '') +
          (pricing.boostActive ? `\nDesconto de boost aplicado: **${pricing.boostPercent}%** enquanto o boost estiver ativo.` : ''),
        embeds: [buildManualPixPaymentEmbed(paymentSettings, signedContract, pricing.payment)],
        components: buildManualPixPaymentActions()
      }));
      await interaction.editReply(toComponentsV2(paymentMode === 'pix_key' ? 'Chave Pix enviada no canal.' : 'QR Code Pix enviado no canal.'));
      await deleteActionPanel(interaction);
      return;
    }

    if (!isPagBankConfigured()) {
      await interaction.editReply(toComponentsV2('O PagBank ainda não está configurado. Defina PAGBANK_TOKEN no .env ou selecione QR Code/chave Pix no /painel.'));
      return;
    }

    try {
      if (!reusedPayment) {
        const referenceId = buildPagBankReference(interaction.guild.id, interaction.channelId);
        const created = await createPixOrder({
          contract: signedContract,
          discordUser: member.user,
          amount: pricing.payment,
          description: `${planLabel(ticket.type)} ${signedContract.projectName || 'Orvitek'}`,
          referenceId
        });
        payment = upsertPayment(interaction.channelId, {
          ...created.payment,
          guildId: interaction.guild.id,
          userId: ticket.ownerId,
          userTag: ticket.ownerTag,
          contractId: signedContract.id,
          projectName: signedContract.projectName,
          plan: ticket.type
        });
      }

      payment = await refreshPagBankPaymentDetails(payment, interaction.channelId);
      if (!isPixCopyPasteText(payment?.qrCodeText)) {
        throw new Error('O PagBank criou o pedido, mas não retornou um Pix copia e cola válido. Verifique se existe uma chave Pix ativa na conta PagBank e tente gerar novamente.');
      }
    } catch (error) {
      if (String(error.message || '').startsWith('Dados do contrato inválidos') || isBuyerMerchantEmailError(error.message)) {
        await interaction.editReply(toComponentsV2({
          content: `${error.message}\n\nClique em **Corrigir contrato** e informe um e-mail do comprador diferente do e-mail da conta PagBank vendedora.`,
          components: buildContractCorrectionActions()
        }));
        return;
      }

      await interaction.editReply(toComponentsV2(`Não consegui gerar o Pix pelo PagBank: ${error.message}`));
      return;
    }

    upsertQueueEntry(interaction.channelId, {
      guildId: interaction.guild.id,
      ownerId: ticket.ownerId,
      ownerTag: ticket.ownerTag,
      plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
      status: 'awaiting_pagbank_payment',
      basePrice: pricing.base,
      finalPrice: pricing.final,
      entryPrice: pricing.payment,
      paidPrice: pricing.payment,
      paymentProvider: 'pagbank',
      paymentOrderId: payment.orderId,
      paymentStatus: payment.status,
      paymentAmountCents: payment.amountCents,
      couponCode: pricing.couponMatches ? pricing.coupon.code : null,
      couponPercent: pricing.couponMatches ? pricing.coupon.percent : 0,
      boostDiscountActive: pricing.boostActive,
      boostDiscountPercent: pricing.boostPercent,
      requestedAt: new Date().toISOString()
    });

    await interaction.channel.send(toComponentsV2({
      content:
        `${interaction.user}, Pix PagBank gerado. Clientes na frente no momento: **${position.ahead}**.` +
        (pricing.couponMatches ? `\nCupom aplicado: **${pricing.coupon.code}** (-${pricing.coupon.percent}%).` : '') +
        (pricing.boostActive ? `\nDesconto de boost aplicado: **${pricing.boostPercent}%** enquanto o boost estiver ativo.` : ''),
      embeds: [buildPagBankPaymentEmbed(payment, signedContract)],
      components: buildPagBankPaymentActions()
    }));
    await interaction.editReply(toComponentsV2(reusedPayment ? 'Pix PagBank reenviado no canal.' : 'Pix PagBank gerado no canal.'));
    await deleteActionPanel(interaction);
    return;
  }

  if (interaction.customId === 'payment_check') {
    const payment = getPayment(interaction.channelId);
    if (payment && payment.provider !== 'pagbank') {
      await interaction.reply(privateReply('Este pagamento é manual. Aguarde a equipe aprovar pelo botão **Pagamento aprovado**.'));
      return;
    }

    if (!isPagBankConfigured()) {
      await interaction.reply(privateReply('O PagBank ainda não está configurado. Defina PAGBANK_TOKEN no .env para consultar o pagamento automático.'));
      return;
    }

    if (!payment?.orderId) {
      await interaction.reply(privateReply('Nenhum Pix PagBank foi gerado para este atendimento ainda.'));
      return;
    }

    if (ticket.ownerId !== interaction.user.id && !isOwnerRole(interaction.member)) {
      await interaction.reply(privateReply('Apenas o cliente deste atendimento ou o Dono pode verificar este pagamento.'));
      return;
    }

    await interaction.deferReply({ flags: 64 });

    let order;
    try {
      order = await consultOrder(payment.orderId);
    } catch (error) {
      await interaction.editReply(toComponentsV2(`Não consegui consultar o PagBank: ${error.message}`));
      return;
    }

    const status = summarizeOrderStatus(order, payment.amountCents);
    const hadInvalidQrText = !isPixCopyPasteText(payment.qrCodeText);
    const hadInvalidQrImage = !payment.qrCodePng || String(payment.qrCodePng).includes('api.pagseguro.com/qrcode/');
    const refreshedPayment = await buildPixPaymentFromOrder(order, payment.amountCents, payment.referenceId || order.reference_id || null);
    const updatedPayment = upsertPayment(interaction.channelId, {
      ...refreshedPayment,
      status: status.paid ? 'paid' : 'awaiting_payment',
      rawStatus: status.status,
      chargeId: status.chargeId || payment.chargeId || null,
      paidAt: status.paidAt || payment.paidAt || null,
      lastCheckedAt: new Date().toISOString()
    });

    upsertQueueEntry(interaction.channelId, {
      paymentStatus: updatedPayment.status,
      paymentProvider: 'pagbank',
      paymentOrderId: payment.orderId,
      paymentChargeId: updatedPayment.chargeId,
      paymentPaidAt: updatedPayment.paidAt || null
    });

    if (!status.paid) {
      if ((hadInvalidQrText || hadInvalidQrImage) && isPixCopyPasteText(updatedPayment.qrCodeText)) {
        await interaction.channel.send(toComponentsV2({
          content: `${interaction.user}, reenviei o Pix com um QR Code atualizado.`,
          embeds: [buildPagBankPaymentEmbed(updatedPayment, signedContract)],
          components: buildPagBankPaymentActions()
        })).catch(() => null);
      }

      await interaction.editReply(toComponentsV2(`Pagamento ainda não confirmado pelo PagBank. Status atual: ${status.status}.`));
      return;
    }

    const latestQueueEntry = getQueueEntry(interaction.channelId);
    if (latestQueueEntry?.status === 'approved' && latestQueueEntry.projectChannelId) {
      await interaction.editReply(toComponentsV2(`Pagamento já confirmado e projeto já liberado em <#${latestQueueEntry.projectChannelId}>.`));
      return;
    }

    const approval = await approveQueuePayment(interaction, setup, ticket, member, interaction.user.id);
    if (!approval.ok) {
      await interaction.editReply(toComponentsV2(approval.reason));
      return;
    }

    await interaction.channel.send(toComponentsV2({
      embeds: [buildPagBankPaymentEmbed(updatedPayment, signedContract)]
    })).catch(() => null);
    await interaction.editReply(toComponentsV2(`Pagamento confirmado pelo PagBank. Canal do projeto criado: ${approval.projectChannel}. Posição atual: **${approval.position.position}**.`));
    await deleteActionPanel(interaction);
    return;
  }

  if (!isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode aprovar ou alterar a etapa da fila.'));
    return;
  }

  if (interaction.customId === 'preapproved_delete_channel') {
    const queueEntry = getQueueEntry(interaction.channelId);
    const payment = getPayment(interaction.channelId);
    const paymentConfirmed = queueEntry?.status === 'approved' || queueEntry?.paymentStatus === 'paid' || payment?.status === 'paid';
    const accessCleanup = paymentConfirmed
      ? {}
      : {
          accessKey: null,
          accessPasswordHash: null,
          accessPasswordSalt: null,
          tempPasswordHash: null,
          tempPasswordSalt: null,
          tempPasswordExpiresAt: null,
          accessGranted: false,
          hostingPaymentStatus: 'cancelled',
          paymentStatus: 'cancelled'
        };

    updateTicket(interaction.channelId, {
      status: 'deleted_preapproved',
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id
    });
    upsertQueueEntry(interaction.channelId, {
      status: 'deleted_preapproved',
      deletedAt: new Date().toISOString(),
      deletedBy: interaction.user.id,
      ...accessCleanup
    });

    if (!paymentConfirmed) {
      upsertClient(interaction.guild.id, ticket.ownerId, {
        userTag: ticket.ownerTag,
        plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
        projectName: queueEntry?.projectName || signedContract?.projectName || ticket.ownerTag,
        status: 'deleted_preapproved',
        hostingStatus: 'cancelled',
        hostingPaymentStatus: 'cancelled',
        paymentTicketChannelId: interaction.channelId,
        preapprovedDeletedAt: new Date().toISOString(),
        preapprovedDeletedBy: interaction.user.id,
        ...accessCleanup
      });

      if (payment?.orderId) {
        upsertPayment(interaction.channelId, {
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          cancelledBy: interaction.user.id
        });
      }
    }

    await interaction.reply(toComponentsV2('Canal será apagado em 5 segundos.'));
    await deleteActionPanel(interaction);
    setTimeout(() => interaction.channel.delete('Canal pré aprovado apagado pelo painel').catch(() => null), 5000);
    return;
  }

  if (interaction.customId === 'payment_reject') {
    const queueEntry = getQueueEntry(interaction.channelId);
    const deleteAt = new Date(Date.now() + PAYMENT_REJECT_DELETE_MS);

    upsertQueueEntry(interaction.channelId, {
      status: 'payment_rejected',
      paymentRejectedAt: new Date().toISOString(),
      paymentRejectedBy: interaction.user.id,
      paymentRejectDeleteAt: deleteAt.toISOString(),
      accessKey: null,
      accessPasswordHash: null,
      accessPasswordSalt: null,
      accessGranted: false
    });

    upsertClient(interaction.guild.id, ticket.ownerId, {
      userTag: ticket.ownerTag,
      plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
      projectName: queueEntry?.projectName || ticket.ownerTag,
      status: 'payment_rejected',
      hostingStatus: 'payment_rejected',
      hostingPaymentStatus: 'rejected',
      paymentTicketChannelId: interaction.channelId,
      paymentRejectedAt: new Date().toISOString(),
      paymentRejectDeleteAt: deleteAt.toISOString(),
      accessKey: null,
      accessPasswordHash: null,
      accessPasswordSalt: null
    });

    await interaction.reply(toComponentsV2(
      `Pagamento recusado. Se o pagamento não for regularizado, este atendimento será apagado automaticamente em 3 horas: <t:${Math.floor(deleteAt.getTime() / 1000)}:R>.`
    ));
    await deleteActionPanel(interaction);
    return;
  }

  if (interaction.customId === 'queue_approve' || interaction.customId === 'payment_approve') {
    const currentPayment = getPayment(interaction.channelId);
    if (currentPayment) {
      upsertPayment(interaction.channelId, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        approvedManuallyBy: interaction.user.id
      });
      upsertQueueEntry(interaction.channelId, {
        paymentStatus: 'paid',
        paymentPaidAt: new Date().toISOString()
      });
    }

    const approval = await approveQueuePayment(interaction, setup, ticket, member, interaction.user.id);
    if (!approval.ok) {
      await interaction.reply(privateReply(approval.reason));
      return;
    }

    await interaction.reply(toComponentsV2(`Pagamento aprovado. Canal do projeto criado: ${approval.projectChannel}. Posição atual: **${approval.position.position}**. Prazo médio: até 5 dias.`));
    await deleteActionPanel(interaction);
    return;
  }

  if (interaction.customId === 'queue_development') {
    upsertQueueEntry(interaction.channelId, {
      status: 'development',
      productionStatus: 'development',
      productionStatusLabel: projectStatusLabels.development,
      developmentAt: new Date().toISOString(),
      developmentBy: interaction.user.id
    });
    await applyProjectProgressRoles(member, setup, 'development');
    await interaction.reply(toComponentsV2(`${member}, seu bot entrou em **desenvolvimento**. A equipe vai atualizar este canal conforme avançar.`));
    return;
  }

  const queueEntry = getQueueEntry(interaction.channelId);
  upsertQueueEntry(interaction.channelId, {
    status: 'ready',
    productionStatus: 'finished',
    productionStatusLabel: projectStatusLabels.finished,
    readyAt: new Date().toISOString(),
    readyBy: interaction.user.id
  });
  await removeConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  await applyProjectProgressRoles(member, setup, 'finished');
  await addConfiguredRole(member, setup, 'active', 'Cliente Ativo');

  const projectChannelId = queueEntry?.projectChannelId || interaction.channelId;
  const projectChannel = await interaction.guild.channels.fetch(projectChannelId).catch(() => null);
  const targetCategory = await interaction.guild.channels.fetch(DELIVERED_PROJECT_CATEGORY_ID).catch(() => null);
  if (projectChannel?.isTextBased() && targetCategory?.type === ChannelType.GuildCategory) {
    await projectChannel.setParent(targetCategory.id, { lockPermissions: false }).catch(() => null);
  }

  if (ticket.type === 'plan_pro') {
    await addConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
    await addConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    await createSupportCall(interaction.guild, setup, member);
  }

  upsertClient(interaction.guild.id, ticket.ownerId, {
    userTag: ticket.ownerTag,
    plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
    status: 'active',
    deliveredAt: new Date().toISOString()
  });

  await interaction.reply(toComponentsV2(
    `${member}, seu bot está **pronto**.\n\n` +
      'Por favor, teste o projeto e envie um feedback neste canal dizendo se está tudo certo ou se precisa de algum ajuste.'
  ));
  await sendDmPanel(member.user, buildDeliveryFeedbackDm(interaction.guild.name));
}

async function handleContractStart(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.reply(privateReply('Este canal não possui um contrato de compra pendente.'));
    return;
  }

  if (ticket.ownerId !== interaction.user.id && !isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas o cliente deste atendimento pode assinar o contrato.'));
    return;
  }

  await interaction.showModal(buildContractModal());
}

async function handleContractSubmit(interaction, setup) {
  await interaction.deferReply({ flags: 64 });

  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.editReply(toComponentsV2('Este canal não possui um contrato de compra pendente.'));
    return;
  }

  if (ticket.ownerId !== interaction.user.id && !isOwnerRole(interaction.member)) {
    await interaction.editReply(toComponentsV2('Apenas o cliente deste atendimento pode assinar o contrato.'));
    return;
  }

  const settings = getSystemSettings(interaction.guild.id);
  const queueEntry = getQueueEntry(interaction.channelId);
  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  const pricing = getPlanPricing(ticket.type, settings, queueEntry?.couponCode || null, { member });
  const contractFields = {
    fullName: interaction.fields.getTextInputValue('fullName'),
    cpf: interaction.fields.getTextInputValue('cpf'),
    email: interaction.fields.getTextInputValue('email'),
    phoneAndPayment: interaction.fields.getTextInputValue('phoneAndPayment'),
    projectName: interaction.fields.getTextInputValue('projectName')
  };

  try {
    validatePagBankCustomer(contractFields, interaction.user);
  } catch (error) {
    await interaction.editReply(toComponentsV2(error.message));
    return;
  }

  const contract = createContract(interaction.channelId, {
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    planType: ticket.type,
    ...contractFields,
    ip: 'não disponível no Discord',
    couponCode: queueEntry?.couponCode || null,
    couponPercent: queueEntry?.couponPercent || 0,
    boostDiscountActive: pricing.boostActive,
    boostDiscountPercent: pricing.boostPercent,
    basePrice: pricing.base,
    finalPrice: pricing.final,
    entryPrice: pricing.final,
    remainingPrice: 0,
    paidPrice: pricing.final
  });

  upsertQueueEntry(interaction.channelId, {
    guildId: interaction.guild.id,
    ownerId: ticket.ownerId,
    ownerTag: ticket.ownerTag,
    plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
    status: 'contract_signed',
    contractId: contract.id,
    projectName: contract.projectName,
    couponCode: contract.couponCode,
    couponPercent: contract.couponPercent,
    boostDiscountActive: contract.boostDiscountActive,
    boostDiscountPercent: contract.boostDiscountPercent,
    basePrice: contract.basePrice,
    finalPrice: contract.finalPrice,
    paidPrice: contract.paidPrice,
    entryPrice: contract.entryPrice,
    remainingPrice: contract.remainingPrice,
    signedAt: contract.signedAt
  });

  const pdfPath = await generateContractPdf(contract);
  const pdfName = `contrato-${contract.id}.pdf`;
  const contractEmbed = buildSignedContractEmbed(contract);
  const dmSent = await interaction.user
    .send({
      embeds: [contractEmbed],
      files: [{ attachment: pdfPath, name: pdfName }]
    })
    .then(() => true)
    .catch((error) => {
      console.warn(`Nao foi possivel enviar contrato em PDF por DM para ${interaction.user.tag}: ${error.message}`);
      return false;
    });

  const logAttachment = new AttachmentBuilder(pdfPath, { name: pdfName });
  const contractLogChannelId = process.env.CONTRACT_LOG_CHANNEL_ID;
  if (contractLogChannelId) {
    const logChannel = await interaction.guild.channels.fetch(contractLogChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel.send(toComponentsV2({
        embeds: [buildSignedContractEmbed(contract)],
        files: [logAttachment]
      })).catch(() => null);
    }
  }

  await purgeChannel(interaction.channel);

  await interaction.channel.send(toComponentsV2(buildPreApprovedPanel(contract)));

  if (!dmSent) {
    await interaction.channel.send({
      content: `${interaction.user}, não consegui enviar o contrato no privado. Segue o PDF assinado neste canal.`,
      files: [{ attachment: pdfPath, name: pdfName }]
    }).catch((error) => {
      console.warn(`Nao foi possivel enviar contrato em PDF no canal ${interaction.channelId}: ${error.message}`);
    });
  }

  await interaction.editReply(toComponentsV2(
    dmSent
      ? 'Contrato assinado. O PDF foi enviado no seu privado.'
      : 'Contrato assinado. Não consegui enviar DM, mas o documento foi gerado e a etapa foi liberada.'
  ));
}

async function purgeChannel(channel) {
  let before;
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const message of messages.values()) {
      await message.delete().catch(() => null);
    }

    before = messages.last().id;
  }
}

async function createSupportCall(guild, setup, member) {
  const name = `call-suporte-${channelSafe(member.user.username)}`.slice(0, 90);
  const existing = guild.channels.cache.find((channel) => channel.name === name && channel.type === ChannelType.GuildVoice);
  if (existing) {
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: setup.categories.supportCategory || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
      },
      ...staffRoleKeys
        .filter((key) => setup.roles[key])
        .map((key) => ({
          id: setup.roles[key],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        }))
    ],
    reason: `Call de suporte do plano Pro para ${member.user.tag}`
  }).catch(() => null);
}

async function sendRatingRequest(user, ticketId = 'manual') {
  await user
    .send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.gold)
          .setTitle('⭐ Como foi seu atendimento?')
          .setDescription('Avalie o suporte que você recebeu')
      ],
      components: [
        new ActionRowBuilder().addComponents(
          ...[1, 2, 3, 4, 5].map((stars) =>
            new ButtonBuilder()
              .setCustomId(`rating:${ticketId}:${stars}`)
              .setLabel('⭐'.repeat(stars))
              .setStyle(ButtonStyle.Secondary)
          )
        )
      ]
    }))
    .catch(() => null);
}

async function openSuggestionModal(interaction) {
  const modal = new ModalBuilder().setCustomId('suggestion_submit').setTitle('Enviar Sugestão');
  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Digite sua sugestão')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleSuggestionSubmit(interaction, setup) {
  const content = interaction.fields.getTextInputValue('content');
  const suggestion = addSuggestion(interaction.guild.id, interaction.user.id, interaction.user.tag, content);
  const channel = setup.channels.reports
    ? await interaction.guild.channels.fetch(setup.channels.reports).catch(() => null)
    : null;

  if (channel?.isTextBased()) {
    const message = await channel.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.purple)
          .setTitle(`Sugestão #${suggestion.id}`)
          .setDescription(content)
          .addFields({ name: 'Enviada por', value: interaction.user.tag })
          .setTimestamp()
      ]
    }));
    await message.react('⬆️').catch(() => null);
    await message.react('⬇️').catch(() => null);
  }

  await interaction.reply(privateReply('Sugestão enviada para a equipe.'));
}

async function handleCouponApply(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await safeReply(interaction, privateReply('Este canal não está registrado como compra.'));
    return true;
  }

  if (ticket.ownerId !== interaction.user.id) {
    await safeReply(interaction, privateReply('Apenas o cliente deste atendimento pode aplicar cupom neste pedido.'));
    return true;
  }

  if (getContract(interaction.channelId)) {
    await safeReply(interaction, privateReply('O cupom precisa ser aplicado antes da assinatura do contrato.'));
    return true;
  }

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('coupon_submit')
      .setTitle('Aplicar Cupom')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('code')
            .setLabel('Código do cupom')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20)
        )
      )
  );
  return true;
}

async function handleCouponSubmit(interaction) {
  const code = interaction.fields.getTextInputValue('code').trim();
  const settings = getSystemSettings(interaction.guild.id);
  const ticket = getTicketByChannel(interaction.channelId);
  const coupon = settings.coupon?.active && settings.coupon?.code ? settings.coupon : null;

  if (!ticket || !purchaseTypes(ticket.type)) {
    await safeReply(interaction, privateReply('Este canal não está registrado como compra.'));
    return true;
  }

  if (ticket.ownerId !== interaction.user.id) {
    await safeReply(interaction, privateReply('Apenas o cliente deste atendimento pode aplicar cupom neste pedido.'));
    return true;
  }

  if (getContract(interaction.channelId)) {
    await safeReply(interaction, privateReply('O cupom precisa ser aplicado antes da assinatura do contrato.'));
    return true;
  }

  if (!coupon || String(coupon.code).trim().toLowerCase() !== code.toLowerCase()) {
    await safeReply(interaction, privateReply('Cupom inválido ou indisponível.'));
    return true;
  }

  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  const pricing = getPlanPricing(ticket.type, settings, code, { member });
  upsertQueueEntry(interaction.channelId, {
    couponCode: coupon.code,
    couponPercent: coupon.percent,
    boostDiscountActive: pricing.boostActive,
    boostDiscountPercent: pricing.boostPercent,
    basePrice: pricing.base,
    finalPrice: pricing.final
  });

  await safeReply(
    interaction,
    privateReply(`Cupom aplicado com sucesso. Novo valor do plano: ${brl(pricing.final)}.`)
  );
  await interaction.channel.send(toComponentsV2({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Cupom aplicado')
        .setDescription(`O cupom **${coupon.code}** foi aplicado com **${coupon.percent}% OFF**.`)
        .addFields(
          { name: 'Valor original', value: brl(pricing.base), inline: true },
          { name: 'Valor com desconto', value: brl(pricing.final), inline: true },
          ...(pricing.boostActive ? [{ name: 'Boost ativo', value: `${pricing.boostPercent}% OFF adicional enquanto o boost estiver ativo.`, inline: true }] : [])
        )
    ]
  })).catch(() => null);
  return true;
}

async function handleCouponClear(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode remover o cupom.'));
    return true;
  }

  clearSystemCoupon(interaction.guild.id, interaction.user.id);
  await publishSalesPanels(interaction.guild, setup);
  await safeReply(interaction, privateReply('Cupom removido com sucesso.'));
  return true;
}

async function handleHostingSelfPaid(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const clientRecord = findClientByProjectChannel(interaction.guild.id, channelId);
  if (!clientRecord || clientRecord.userId !== interaction.user.id) {
    await interaction.reply(toComponentsV2({ content: 'Não encontrei uma cobrança ativa para você.' }));
    return true;
  }

  upsertClient(interaction.guild.id, interaction.user.id, {
    hostingPaymentStatus: 'awaiting_review',
    hostingLastUserReportAt: new Date().toISOString()
  });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.user) {
    await member.user.send(toComponentsV2({
      embeds: [buildHostingPaymentInstructionDm({ guildName: interaction.guild.name, projectName: clientRecord.projectName })]
    })).catch(() => null);
  }

  await logHostingEvent(
    interaction.guild,
    new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle('Cliente informou pagamento')
      .addFields(
        { name: 'Cliente', value: interaction.user.tag, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true }
      )
      .setTimestamp()
  );

  await interaction.reply(toComponentsV2({ content: 'Confirmação recebida. Envie o comprovante no ticket para validação.' }));
  return true;
}

async function handleHostingSelfUnpaid(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const clientRecord = findClientByProjectChannel(interaction.guild.id, channelId);
  if (!clientRecord || clientRecord.userId !== interaction.user.id) {
    await interaction.reply(toComponentsV2({ content: 'Não encontrei uma cobrança ativa para você.' }));
    return true;
  }

  await revokeHostingAccess(interaction.guild, clientRecord, {
    reason: 'Cliente informou falta de pagamento',
    byUserId: interaction.user.id
  });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.user) {
    await member.user.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('Acesso interrompido')
          .setDescription(
            'Seu acesso foi interrompido por falta de pagamento.\n\n' +
              'Abra um ticket para regularizar a hospedagem e recuperar o acesso dentro do prazo de tolerância.'
          )
      ]
    })).catch(() => null);
  }

  await interaction.reply(toComponentsV2({ content: 'Acesso interrompido. Você receberá as instruções por DM.' }));
  return true;
}

async function handleHostingAdminSubmit(interaction, setup, isPaid) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode usar este controle.'));
    return true;
  }

  const userInput = interaction.fields.getTextInputValue('user');
  const channelInput = interaction.fields.getTextInputValue('channel').trim();
  const clientRecord = findClientByInput(interaction.guild.id, userInput);

  if (!clientRecord) {
    await safeReply(interaction, privateReply('Não encontrei esse cliente no sistema.'));
    return true;
  }

  if (channelInput && clientRecord.projectChannelId && channelInput.replace(/[<#>]/g, '') !== clientRecord.projectChannelId) {
    await safeReply(interaction, privateReply('O canal informado não corresponde ao projeto desse cliente.'));
    return true;
  }

  if (isPaid) {
    const result = await restoreHostingAccess(interaction.guild, clientRecord, { byUserId: interaction.user.id });
    if (!result.ok) {
      await safeReply(interaction, privateReply(result.reason));
      return true;
    }

    await safeReply(interaction, privateReply(`Hospedagem marcada como paga para ${clientRecord.userTag || clientRecord.userId}.`));
    return true;
  }

  await revokeHostingAccess(interaction.guild, clientRecord, {
    reason: 'Marcação manual de hospedagem vencida',
    byUserId: interaction.user.id
  });
  await safeReply(interaction, privateReply(`Hospedagem marcada como vencida para ${clientRecord.userTag || clientRecord.userId}.`));
  return true;
}

async function handleHostingAdminUserSelect(interaction, isPaid) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode usar este controle.'));
    return true;
  }

  const userId = interaction.values?.[0];
  const clientRecord = userId ? getClient(interaction.guild.id, userId) : null;

  if (!clientRecord) {
    await safeReply(interaction, privateReply('Esse usuário ainda não tem um projeto registrado no sistema.'));
    return true;
  }

  if (isPaid) {
    const result = await restoreHostingAccess(interaction.guild, clientRecord, { byUserId: interaction.user.id });
    if (!result.ok) {
      await safeReply(interaction, privateReply(result.reason));
      return true;
    }

    await safeUpdate(interaction, {
      content: `Hospedagem marcada como paga para ${clientRecord.userTag || `<@${userId}>`}.`,
      embeds: [],
      components: []
    });
    return true;
  }

  await revokeHostingAccess(interaction.guild, clientRecord, {
    reason: 'Marcação manual de hospedagem vencida',
    byUserId: interaction.user.id
  });

  await safeUpdate(interaction, {
    content: `Hospedagem marcada como vencida para ${clientRecord.userTag || `<@${userId}>`}.`,
    embeds: [],
    components: []
  });
  return true;
}

async function handleDashboardVerificationUserSelect(interaction) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode gerar código da dashboard.'));
    return true;
  }

  const userId = interaction.values?.[0];
  const user = interaction.users?.get(userId) || await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) {
    await safeReply(interaction, privateReply('Não consegui localizar esse usuário.'));
    return true;
  }

  const record = createDashboardVerificationCode(interaction.guild.id, user.id, {
    userTag: user.tag,
    createdBy: interaction.user.id
  });
  const expiresText = record.expiresAt ? `<t:${Math.floor(new Date(record.expiresAt).getTime() / 1000)}:R>` : 'em breve';
  const dmSent = await sendDmPanel(
    user,
    buildDashboardVerificationCodeDm({
      guildName: interaction.guild.name,
      code: record.code,
      expiresAt: record.expiresAt
    })
  );

  await safeUpdate(interaction, {
    content:
      `Código da dashboard gerado para ${user}.\n` +
      `Código: \`${record.code}\`\n` +
      `Expira: ${expiresText}\n` +
      (dmSent ? 'Enviei o código por DM.' : 'Não consegui enviar DM. Envie o código ao usuário por outro canal seguro.'),
    embeds: [],
    components: []
  });
  return true;
}

async function applyClientPlanChange(guild, setup, userId, plan, changedByUserId) {
  const clientRecord = getClient(guild.id, userId);
  if (!clientRecord) {
    return { ok: false, reason: 'Esse usuário ainda não tem um projeto registrado no sistema.' };
  }

  const changedAt = new Date().toISOString();
  upsertClient(guild.id, userId, {
    plan,
    planChangedAt: changedAt,
    planChangedBy: changedByUserId
  });

  for (const entry of listQueueEntries(guild.id, userId)) {
    upsertQueueEntry(entry.channelId, {
      plan,
      planChangedAt: changedAt,
      planChangedBy: changedByUserId
    });
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    if (plan === 'premium') {
      await addConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
      await addConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    } else {
      await removeConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
      await removeConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    }
  }

  return { ok: true, clientRecord: getClient(guild.id, userId) || clientRecord };
}

async function handleClientPlanUserSelect(interaction) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode mudar o plano de um usuário.'));
    return true;
  }

  const userId = interaction.values?.[0];
  const clientRecord = userId ? getClient(interaction.guild.id, userId) : null;
  if (!clientRecord) {
    await safeReply(interaction, privateReply('Esse usuário ainda não tem um projeto registrado no sistema.'));
    return true;
  }

  await safeUpdate(interaction, buildClientPlanSelectPayload(userId, clientRecord));
  return true;
}

async function handleClientPlanSelect(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode mudar o plano de um usuário.'));
    return true;
  }

  const [, userId] = interaction.customId.split(':');
  const plan = planValueFromType(interaction.values?.[0]);
  const result = await applyClientPlanChange(interaction.guild, setup, userId, plan, interaction.user.id);
  if (!result.ok) {
    await safeReply(interaction, privateReply(result.reason));
    return true;
  }

  await safeUpdate(interaction, {
    content: `Plano de <@${userId}> alterado para **${planLabel(plan)}**.`,
    embeds: [],
    components: []
  });
  return true;
}

async function handleClientDeleteUserSelect(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode apagar cadastros.'));
    return true;
  }

  const userId = interaction.values?.[0];
  const clientRecord = userId ? getClient(interaction.guild.id, userId) : null;
  if (!clientRecord) {
    await safeReply(interaction, privateReply('Esse usuário não tem cadastro ativo no sistema.'));
    return true;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const projectChannel = clientRecord.projectChannelId
    ? await interaction.guild.channels.fetch(clientRecord.projectChannelId).catch(() => null)
    : null;
  const projectCategory = clientRecord.projectCategoryId
    ? await interaction.guild.channels.fetch(clientRecord.projectCategoryId).catch(() => null)
    : null;

  let dmSent = false;
  const goodbyeEmbed = new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Encerramento do projeto')
    .setDescription(
      `Foi um prazer trabalhar com você, **${member?.user?.username || clientRecord.userTag || 'cliente'}**.\n\n` +
        'A Orvitek agradece pela confiança e sempre estará disponível quando você precisar de um novo projeto, ajuste ou suporte.'
    )
    .addFields(
      { name: 'Projeto encerrado', value: clientRecord.projectName || 'Não informado', inline: true },
      { name: 'Status', value: 'Cadastro finalizado', inline: true },
      { name: 'Próximo passo', value: 'Quando quiser voltar, abra um ticket no servidor e fale com a equipe.' }
    )
    .setFooter({ text: 'Orvitek - obrigado por trabalhar conosco.' })
    .setTimestamp();

  if (member) {
    await removeConfiguredRole(member, setup, 'active', 'Cliente Ativo');
    await removeConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    await removeConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
    await removeConfiguredRole(member, setup, 'queue', 'Na Fila');
    await removeConfiguredRole(member, setup, 'development', 'Bot em Desenvolvimento');
    await removeConfiguredRole(member, setup, 'expired', 'Cliente Expirado');
    await addConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  }

  const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
  if (user) {
    dmSent = await user.send(toComponentsV2({ embeds: [goodbyeEmbed] })).then(() => true).catch(() => false);
  }

  if (!dmSent && projectChannel?.isTextBased()) {
    await projectChannel.send(toComponentsV2({ content: `<@${userId}>`, embeds: [goodbyeEmbed] })).catch(() => null);
  }

  if (projectChannel?.deletable) {
    setTimeout(() => projectChannel.delete('Cadastro do cliente apagado pelo painel').catch(() => null), dmSent ? 0 : 15000);
  }

  if (projectCategory?.deletable) {
    setTimeout(() => projectCategory.delete('Categoria do cliente apagada pelo painel').catch(() => null), dmSent ? 1500 : 17000);
  }

  deleteClient(interaction.guild.id, userId);

  await logHostingEvent(
    interaction.guild,
    new EmbedBuilder()
      .setColor(colors.red)
      .setTitle('Cadastro apagado')
      .addFields(
        { name: 'Cliente', value: clientRecord.userTag || `<@${userId}>`, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
        { name: 'Apagado por', value: interaction.user.tag, inline: true }
      )
      .setTimestamp()
  );

  await safeUpdate(interaction, {
    content:
      `Cadastro apagado para ${clientRecord.userTag || `<@${userId}>`}. O cargo voltou para Futuro Cliente e o canal do projeto foi removido.` +
      (dmSent ? '\nDM de despedida enviada.' : '\nNão consegui enviar DM. O aviso foi enviado no canal antes da exclusão.'),
    embeds: [],
    components: []
  });
  return true;
}

async function handleHostingAccessCreateButton(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.reply(privateReply('Este canal não está registrado como compra.'));
    return true;
  }

  if (ticket.ownerId !== interaction.user.id) {
    await interaction.reply(privateReply('Apenas o cliente deste atendimento pode criar a chave de acesso.'));
    return true;
  }

  const queueEntry = getQueueEntry(interaction.channelId);
  if (queueEntry?.accessKey && queueEntry?.accessPasswordHash) {
    await interaction.reply(privateReply('A chave de acesso deste canal já foi criada.'));
    return true;
  }

  await interaction.showModal(buildHostingAccessCreateModal());
  await deleteActionPanel(interaction);
  return true;
}

async function handleHostingAccessCreateSubmit(interaction) {
  await interaction.deferReply({ flags: 64 });

  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.editReply(toComponentsV2('Este canal não está registrado como compra.'));
    return true;
  }

  const contract = getContract(interaction.channelId);

  if (ticket.ownerId !== interaction.user.id) {
    await interaction.editReply(toComponentsV2('Apenas o cliente deste atendimento pode criar a chave de acesso.'));
    return true;
  }

  const botName = interaction.fields.getTextInputValue('botName').trim();
  const password = interaction.fields.getTextInputValue('password').trim();
  const confirmPassword = interaction.fields.getTextInputValue('confirmPassword').trim();

  if (password.length < 4) {
    await interaction.editReply(toComponentsV2('A senha precisa ter no mínimo 4 caracteres.'));
    return true;
  }

  if (password !== confirmPassword) {
    await interaction.editReply(toComponentsV2('A confirmação da senha não confere.'));
    return true;
  }

  const queueEntry = getQueueEntry(interaction.channelId) || {};
  const projectName = botName || queueEntry.projectName || ticket.ownerTag;
  let accessKey = generateAccessKey(projectName);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!findClientByAccessKey(interaction.guild.id, accessKey)) break;
    accessKey = generateAccessKey(projectName, attempt + 2);
  }

  const { salt, hash } = hashHostingPassword(password);
  const dueAt = getNextHostingDueDate();
  const hostingCycle = getHostingCycleKey(dueAt);

  upsertQueueEntry(interaction.channelId, {
    guildId: interaction.guild.id,
    ownerId: ticket.ownerId,
    ownerTag: ticket.ownerTag,
    plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
    status: 'access_key_created',
    projectName,
    accessKey,
    accessPasswordHash: hash,
    accessPasswordSalt: salt,
    accessKeyCreatedAt: new Date().toISOString(),
    accessKeyCreatedBy: interaction.user.id,
    hostingPaymentStatus: 'key_created',
    hostingCycle,
    hostingDueAt: dueAt.toISOString(),
    hostingGraceUntil: getHostingGraceDeadline(dueAt).toISOString(),
    hostingReminderCycle: null
  });

  upsertClient(interaction.guild.id, ticket.ownerId, {
    userTag: ticket.ownerTag,
    plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
    projectName,
    accessKey,
    accessPasswordHash: hash,
    accessPasswordSalt: salt,
    status: 'pending_payment',
    hostingStatus: 'awaiting_payment',
    hostingPaymentStatus: 'key_created',
    hostingCycle,
    hostingDueAt: dueAt.toISOString(),
    hostingGraceUntil: getHostingGraceDeadline(dueAt).toISOString(),
    hostingReminderCycle: null,
    hostingKeyCreatedAt: new Date().toISOString(),
    hostingKeyCreatedBy: interaction.user.id
  });

  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  if (member?.user) {
    await sendDmPanel(
      member.user,
      buildHostingAccessCreatedDm({
        guildName: interaction.guild.name,
        projectName,
        accessKey
      })
    );
  }

  await logHostingEvent(
    interaction.guild,
    new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle('Chave de acesso criada')
      .addFields(
        { name: 'Cliente', value: ticket.ownerTag, inline: true },
        { name: 'Projeto', value: projectName || 'não informado', inline: true },
        { name: 'Chave', value: accessKey, inline: true }
      )
      .setTimestamp()
  );

  await interaction.channel.send(toComponentsV2(buildPaymentStepPanel(contract, { projectName, accessKey }))).catch(() => null);

  await interaction.editReply(toComponentsV2(`Chave criada com sucesso: \`${accessKey}\`. O cliente recebeu a orientação por DM.`));
  return true;
}

async function handleAccessUnlockButton(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(toComponentsV2({ content: 'Não encontrei um acesso pendente para você.' }));
    return true;
  }

  const modal = new ModalBuilder().setCustomId(`access_submit:${channelId}`).setTitle('Liberar acesso ao canal');
  const key = new TextInputBuilder()
    .setCustomId('key')
    .setLabel('Chave de acesso')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(queueEntry.accessKey || ''));
  const password = new TextInputBuilder()
    .setCustomId('password')
    .setLabel('Senha de acesso')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(key));
  modal.addComponents(new ActionRowBuilder().addComponents(password));
  await interaction.showModal(modal);
  await deleteActionPanel(interaction);
  return true;
}

async function handleAccessUnlockSubmit(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(toComponentsV2({ content: 'Não encontrei um acesso pendente para você.' }));
    return true;
  }

  const key = interaction.fields.getTextInputValue('key').trim();
  const password = interaction.fields.getTextInputValue('password').trim();

  if (password.length < 4) {
    await interaction.reply(toComponentsV2({ content: 'A senha precisa ter no mínimo 4 caracteres.' }));
    return true;
  }

  const matchesKey = String(queueEntry.accessKey || '').trim().toLowerCase() === key.toLowerCase();
  const passwordCheck = verifyAccessPassword(password, queueEntry);

  if (!matchesKey || !passwordCheck.ok) {
    await interaction.reply(toComponentsV2({ content: 'Chave ou senha incorreta. Verifique a DM com as instruções e tente novamente.' }));
    return true;
  }

  if (passwordCheck.temporary) {
    await interaction.reply(toComponentsV2({ content: 'Essa senha é temporária. Use o botão Mudar senha para definir uma nova senha antes de liberar o envio de mensagens.' }));
    return true;
  }

  const guild = await interaction.client.guilds.fetch(queueEntry.guildId).catch(() => null);
  if (!guild) {
    await interaction.reply(toComponentsV2({ content: 'Não consegui localizar o servidor deste acesso.' }));
    return true;
  }

  const setup = resolveGuildSetup(guild);
  const projectChannelId = queueEntry.projectChannelId || channelId;
  const channel = await guild.channels.fetch(projectChannelId).catch(() => null);
  if (!setup || !channel?.isTextBased()) {
    await interaction.reply(toComponentsV2({ content: 'Não consegui localizar o canal do projeto.' }));
    return true;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply(toComponentsV2({ content: 'Não consegui localizar sua conta no servidor.' }));
    return true;
  }

  await channel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  }).catch(() => null);

  upsertQueueEntry(channelId, {
    accessGranted: true,
    accessGrantedAt: new Date().toISOString(),
    accessGrantedBy: interaction.user.id,
    accessSuspendedForPasswordReset: false
  });

  upsertClient(guild.id, interaction.user.id, {
    status: 'active',
    projectChannelId,
    accessGrantedAt: new Date().toISOString(),
    hostingStatus: 'current',
    hostingPaymentStatus: 'paid',
    hostingPaidAt: new Date().toISOString(),
    accessSuspendedForPasswordReset: false
  });

  await interaction.reply(toComponentsV2({ content: 'Acesso liberado com sucesso. Você já pode ver o canal do projeto.' }));
  await sendDmPanel(
    interaction.user,
    buildAccessUnlockedDm({
      guildName: guild.name,
      projectName: queueEntry.projectName || 'seu projeto',
      channelName: `<#${projectChannelId}>`
    })
  );

  await channel.send(toComponentsV2(buildProjectDeadlinePanel({ ...queueEntry, channelId }))).catch(() => null);
  await channel.send(toComponentsV2({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('✅ Acesso liberado')
        .setDescription(`<@${interaction.user.id}> agora pode visualizar e enviar mensagens neste canal.`)
        .setTimestamp()
    ]
  })).catch(() => null);

  return true;
}

async function setProjectWriteAccess(guild, channelId, userId, allowed) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: Boolean(allowed),
    ReadMessageHistory: true
  }).catch(() => null);

  return channel;
}

function verifyAccessPassword(password, queueEntry) {
  const mainPasswordMatches =
    queueEntry.accessPasswordHash && queueEntry.accessPasswordSalt
      ? verifyHostingPassword(password, queueEntry.accessPasswordSalt, queueEntry.accessPasswordHash)
      : String(queueEntry.accessPassword || '') === password;

  if (mainPasswordMatches) {
    return { ok: true, temporary: false };
  }

  const tempValid = queueEntry.tempPasswordExpiresAt && Date.now() < new Date(queueEntry.tempPasswordExpiresAt).getTime();
  const tempMatches =
    tempValid &&
    queueEntry.tempPasswordHash &&
    queueEntry.tempPasswordSalt &&
    verifyHostingPassword(password, queueEntry.tempPasswordSalt, queueEntry.tempPasswordHash);

  return { ok: Boolean(tempMatches), temporary: Boolean(tempMatches) };
}

async function handleAccessRecoverButton(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(privateReply('Não encontrei um acesso para você recuperar.'));
    return true;
  }

  const tempPassword = generateAccessPassword();
  const { salt, hash } = hashHostingPassword(tempPassword);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const projectChannelId = queueEntry.projectChannelId || channelId;
  const guild = await interaction.client.guilds.fetch(queueEntry.guildId || interaction.guildId).catch(() => interaction.guild);

  if (guild) {
    await setProjectWriteAccess(guild, projectChannelId, interaction.user.id, false);
  }

  upsertQueueEntry(channelId, {
    tempPasswordHash: hash,
    tempPasswordSalt: salt,
    tempPasswordExpiresAt: expiresAt.toISOString(),
    accessGranted: false,
    accessSuspendedForPasswordReset: true
  });

  upsertClient(queueEntry.guildId || interaction.guildId, interaction.user.id, {
    accessGranted: false,
    accessSuspendedForPasswordReset: true,
    tempPasswordExpiresAt: expiresAt.toISOString()
  });

  const dmSent = await interaction.user.send(toComponentsV2({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Senha temporária')
        .setDescription(
          `Sua senha temporária para **${queueEntry.projectName || 'seu projeto'}** é:\n\n` +
            `\`${tempPassword}\`\n\n` +
            'Ela expira em 5 minutos. Use o botão **Mudar senha** no painel do projeto para definir uma nova senha.'
        )
        .setTimestamp()
    ]
  })).then(() => true).catch(() => false);

  await interaction.reply(privateReply(
    dmSent
      ? 'Enviei uma senha temporária no seu privado. Seu envio de mensagens ficará bloqueado até você mudar a senha.'
      : 'Não consegui enviar DM. Ative suas mensagens privadas e tente recuperar a senha novamente.'
  ));
  await deleteActionPanel(interaction);
  return true;
}

async function handleAccessChangeButton(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(privateReply('Não encontrei um acesso para você alterar.'));
    return true;
  }

  const modal = new ModalBuilder().setCustomId(`access_change_submit:${channelId}`).setTitle('Mudar senha');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('currentPassword')
      .setLabel('Senha atual ou temporária')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(64)
  ));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('newPassword')
      .setLabel('Nova senha')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(64)
  ));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('confirmPassword')
      .setLabel('Confirmar nova senha')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(64)
  ));

  await interaction.showModal(modal);
  await deleteActionPanel(interaction);
  return true;
}

async function handleAccessChangeSubmit(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);
  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(privateReply('Não encontrei um acesso para você alterar.'));
    return true;
  }

  const currentPassword = interaction.fields.getTextInputValue('currentPassword').trim();
  const newPassword = interaction.fields.getTextInputValue('newPassword').trim();
  const confirmPassword = interaction.fields.getTextInputValue('confirmPassword').trim();

  if (newPassword.length < 4) {
    await interaction.reply(privateReply('A nova senha precisa ter no mínimo 4 caracteres.'));
    return true;
  }

  if (newPassword !== confirmPassword) {
    await interaction.reply(privateReply('A confirmação da nova senha não confere.'));
    return true;
  }

  const passwordCheck = verifyAccessPassword(currentPassword, queueEntry);
  if (!passwordCheck.ok) {
    await interaction.reply(privateReply('Senha atual ou temporária incorreta/expirada.'));
    return true;
  }

  const { salt, hash } = hashHostingPassword(newPassword);
  const guild = await interaction.client.guilds.fetch(queueEntry.guildId || interaction.guildId).catch(() => interaction.guild);
  const projectChannelId = queueEntry.projectChannelId || channelId;
  if (guild) {
    await setProjectWriteAccess(guild, projectChannelId, interaction.user.id, true);
  }

  upsertQueueEntry(channelId, {
    accessPasswordHash: hash,
    accessPasswordSalt: salt,
    tempPasswordHash: null,
    tempPasswordSalt: null,
    tempPasswordExpiresAt: null,
    accessGranted: true,
    accessSuspendedForPasswordReset: false,
    passwordChangedAt: new Date().toISOString()
  });

  upsertClient(queueEntry.guildId || interaction.guildId, interaction.user.id, {
    accessPasswordHash: hash,
    accessPasswordSalt: salt,
    accessGranted: true,
    accessSuspendedForPasswordReset: false,
    tempPasswordExpiresAt: null,
    passwordChangedAt: new Date().toISOString()
  });

  await interaction.reply(privateReply('Senha alterada com sucesso. Seu envio de mensagens no canal do projeto foi liberado.'));
  return true;
}

async function handleProjectSupportButton(interaction) {
  const [, queueChannelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(queueChannelId);
  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply(privateReply('Este painel de suporte não pertence ao seu projeto.'));
    return true;
  }

  const alertUserId = process.env.SUPPORT_ALERT_USER_ID || process.env.OWNER_USER_ID || interaction.guild?.ownerId;
  const alertUser = alertUserId ? await interaction.client.users.fetch(alertUserId).catch(() => null) : null;
  const dmSent = alertUser
    ? await alertUser.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.orange)
          .setTitle('Cliente chamou suporte')
          .setDescription(`${interaction.user.tag} precisa de suporte no projeto **${queueEntry.projectName || 'não informado'}**.`)
          .addFields(
            { name: 'Cliente', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Canal', value: queueEntry.projectChannelId ? `<#${queueEntry.projectChannelId}>` : 'não informado', inline: true }
          )
          .setTimestamp()
      ]
    })).then(() => true).catch(() => false)
    : false;

  await interaction.reply(privateReply(dmSent ? 'Suporte chamado. A equipe recebeu o aviso.' : 'Não consegui enviar o aviso por DM para o responsável.'));
  return true;
}

async function handleContractEndButton(interaction) {
  const [, queueChannelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(queueChannelId);
  if (!queueEntry) {
    await interaction.reply(privateReply('Não encontrei este contrato/projeto.'));
    return true;
  }

  const isOwner = queueEntry.ownerId === interaction.user.id;
  if (!isOwner && !isStaff(interaction.member) && !isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas o cliente ou a equipe pode encerrar este contrato.'));
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`contract_end_submit:${queueChannelId}`)
    .setTitle('Encerrar contrato');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Motivo do encerramento')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000)
      .setPlaceholder('Explique o motivo do encerramento do contrato.')
  ));

  await interaction.showModal(modal);
  return true;
}

async function handleContractEndSubmit(interaction) {
  const [, queueChannelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(queueChannelId);
  if (!queueEntry) {
    await interaction.reply(privateReply('Não encontrei este contrato/projeto.'));
    return true;
  }

  const isOwner = queueEntry.ownerId === interaction.user.id;
  if (!isOwner && !isStaff(interaction.member) && !isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas o cliente ou a equipe pode encerrar este contrato.'));
    return true;
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  const endedAt = new Date().toISOString();
  upsertQueueEntry(queueChannelId, {
    status: 'contract_ended',
    contractEndedAt: endedAt,
    contractEndedBy: interaction.user.id,
    contractEndReason: reason,
    hostingStatus: 'deleted',
    hostingPaymentStatus: 'cancelled',
    accessGranted: false,
    accessKey: null,
    accessPasswordHash: null,
    accessPasswordSalt: null,
    tempPasswordHash: null,
    tempPasswordSalt: null,
    tempPasswordExpiresAt: null,
    hostingDeletedAt: endedAt,
    hostingDeletedBy: interaction.user.id,
    paymentRejectDeleteAt: null
  });

  upsertClient(interaction.guild.id, queueEntry.ownerId, {
    status: 'contract_ended',
    contractEndedAt: endedAt,
    contractEndedBy: interaction.user.id,
    contractEndReason: reason,
    hostingStatus: 'deleted',
    hostingPaymentStatus: 'cancelled',
    accessGranted: false,
    accessKey: null,
    accessPasswordHash: null,
    accessPasswordSalt: null,
    hostingDeletedAt: endedAt,
    hostingDeletedBy: interaction.user.id,
    paymentTicketChannelId: null,
    paymentRejectDeleteAt: null
  });

  const member = await interaction.guild.members.fetch(queueEntry.ownerId).catch(() => null);
  const setup = resolveGuildSetup(interaction.guild) || {};
  if (member) {
    await removeConfiguredRole(member, setup, 'queue', 'Na Fila');
    await removeConfiguredRole(member, setup, 'development', 'Bot em Desenvolvimento');
    await removeConfiguredRole(member, setup, 'delivered', 'Bot Entregue');
    await removeConfiguredRole(member, setup, 'active', 'Cliente Ativo');
    await removeConfiguredRole(member, setup, 'vip', 'Cliente VIP');
    await removeConfiguredRole(member, setup, 'proPlan', 'Plano Pro');
    await addConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  }

  const projectChannelId = queueEntry.projectChannelId || queueChannelId;
  const projectChannel = await interaction.guild.channels.fetch(projectChannelId).catch(() => null);
  const projectChannelCanBeDeleted = Boolean(projectChannel?.deletable);
  if (projectChannel?.isTextBased()) {
    await clearProjectFinalPanels(projectChannel);
    await projectChannel.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('Contrato encerrado')
          .setDescription(
            'Este contrato foi encerrado.' +
              (projectChannelCanBeDeleted ? '\n\nEste canal será apagado em 5 segundos.' : '')
          )
          .addFields(
            { name: 'Projeto', value: queueEntry.projectName || 'não informado', inline: true },
            { name: 'Encerrado por', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Motivo', value: reason.slice(0, 1000) }
          )
        .setTimestamp()
    ]
    })).catch(() => null);

    if (!projectChannelCanBeDeleted) {
      await projectChannel.send(toComponentsV2(buildProjectSupportPanel({
        ...queueEntry,
        channelId: queueChannelId,
        productionStatusLabel: 'Contrato encerrado'
      }))).catch(() => null);
    }
  }

  if (member?.user) {
    await sendDmPanel(
      member.user,
      new EmbedBuilder()
        .setColor(colors.red)
        .setTitle('Contrato encerrado')
        .setDescription(`O contrato do projeto **${queueEntry.projectName || 'seu projeto'}** foi encerrado.`)
        .addFields({ name: 'Motivo', value: reason.slice(0, 1000) })
        .setTimestamp()
    );
  }

  const projectChannelDeleteScheduled = projectChannelCanBeDeleted
    ? scheduleChannelDeletion(projectChannel, auditLogReason('Contrato encerrado pelo painel', reason))
    : false;
  if (projectChannelDeleteScheduled) {
    upsertQueueEntry(queueChannelId, {
      projectChannelDeleteScheduledAt: endedAt,
      projectChannelDeleteScheduledBy: interaction.user.id
    });
    upsertClient(interaction.guild.id, queueEntry.ownerId, {
      projectChannelDeleteScheduledAt: endedAt,
      projectChannelDeleteScheduledBy: interaction.user.id
    });
  }

  await interaction.reply(privateReply(
    projectChannelDeleteScheduled
      ? 'Contrato encerrado, motivo registrado e canal será apagado em 5 segundos.'
      : 'Contrato encerrado e motivo registrado. Não consegui agendar a exclusão do canal; verifique as permissões do bot.'
  ));
  return true;
}

async function handleProjectStatusButton(interaction) {
  const [, queueChannelId, status] = interaction.customId.split(':');
  const label = projectStatusLabels[status];
  if (!label) {
    await interaction.reply(privateReply('Status inválido.'));
    return true;
  }

  if (!isStaff(interaction.member) && !isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas a equipe pode atualizar o andamento do projeto.'));
    return true;
  }

  const queueEntry = getQueueEntry(queueChannelId);
  if (!queueEntry) {
    await interaction.reply(privateReply('Não encontrei este projeto.'));
    return true;
  }

  const expectedStatus = nextProjectStatus(queueEntry.productionStatus);
  if (status !== expectedStatus) {
    await interaction.reply(privateReply(
      expectedStatus
        ? `A próxima etapa correta é **${projectStatusLabels[expectedStatus]}**.`
        : 'Este projeto já concluiu todas as etapas.'
    ));
    return true;
  }

  upsertQueueEntry(queueChannelId, {
    productionStatus: status,
    productionStatusLabel: label,
    productionStatusUpdatedAt: new Date().toISOString(),
    productionStatusUpdatedBy: interaction.user.id,
    status: status === 'finished' ? 'ready' : status
  });

  upsertClient(interaction.guild.id, queueEntry.ownerId, {
    productionStatus: status,
    productionStatusLabel: label,
    productionStatusUpdatedAt: new Date().toISOString()
  });

  const member = await interaction.guild.members.fetch(queueEntry.ownerId).catch(() => null);
  if (member) {
    await applyProjectProgressRoles(member, resolveGuildSetup(interaction.guild) || {}, status);
  }

  const projectChannelId = queueEntry.projectChannelId || queueChannelId;
  const projectChannel = await interaction.guild.channels.fetch(projectChannelId).catch(() => null);
  if (status === 'finished' && projectChannel?.isTextBased()) {
    const targetCategory = await interaction.guild.channels.fetch(DELIVERED_PROJECT_CATEGORY_ID).catch(() => null);
    if (targetCategory?.type === ChannelType.GuildCategory) {
      await projectChannel.setParent(targetCategory.id, { lockPermissions: false }).catch(() => null);
    }
  }

  if (member?.user) {
    await sendDmPanel(
      member.user,
      new EmbedBuilder()
        .setColor(status === 'finished' ? colors.default : colors.gold)
        .setTitle('Andamento do projeto atualizado')
        .setDescription(`Seu projeto **${queueEntry.projectName || 'seu projeto'}** está agora em: **${label}**.`)
        .setTimestamp()
    );
  }

  await interaction.reply(toComponentsV2({ content: `Status atualizado para **${label}**.` }));
  await deleteActionPanel(interaction);

  const updatedQueueEntry = getQueueEntry(queueChannelId) || {
    ...queueEntry,
    productionStatus: status,
    productionStatusLabel: label
  };
  if (projectChannel?.isTextBased()) {
    if (status === 'finished') {
      await clearProjectFinalPanels(projectChannel);
      await projectChannel.send(toComponentsV2(buildProjectSupportPanel(updatedQueueEntry))).catch(() => null);
    } else {
      await projectChannel.send(toComponentsV2(buildProjectStatusPanel(updatedQueueEntry))).catch(() => null);
    }
  }
  return true;
}

async function handleProjectDeadlineButton(interaction) {
  if (!isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode definir o prazo.'));
    return true;
  }

  const [, queueChannelId] = interaction.customId.split(':');
  const modal = new ModalBuilder().setCustomId(`project_deadline_submit:${queueChannelId}`).setTitle('Definir prazo');
  const deadline = new TextInputBuilder()
    .setCustomId('deadline')
    .setLabel('Prazo para iniciar o desenvolvimento')
    .setPlaceholder('Ex: 48 horas, 3 dias ou 20/05/2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  modal.addComponents(new ActionRowBuilder().addComponents(deadline));
  await interaction.showModal(modal);
  await deleteActionPanel(interaction);
  return true;
}

async function handleProjectDeadlineSubmit(interaction) {
  if (!isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode definir o prazo.'));
    return true;
  }

  const [, queueChannelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(queueChannelId);
  if (!queueEntry) {
    await interaction.reply(privateReply('Não encontrei este projeto na fila.'));
    return true;
  }

  const deadline = interaction.fields.getTextInputValue('deadline').trim();
  upsertQueueEntry(queueChannelId, {
    developmentStartDeadline: deadline,
    developmentStartDeadlineSetAt: new Date().toISOString(),
    developmentStartDeadlineSetBy: interaction.user.id
  });

  const channel = queueEntry.projectChannelId ? await interaction.guild.channels.fetch(queueEntry.projectChannelId).catch(() => null) : interaction.channel;
  if (channel?.isTextBased()) {
    await channel.send(toComponentsV2({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.gold)
          .setTitle('Prazo informado')
          .setDescription(
            `O prazo para iniciar o desenvolvimento é **${deadline}**.\n\n` +
              'Se o desenvolvimento não iniciar até esse prazo, o cliente poderá solicitar reembolso conforme o acordo.'
          )
          .setTimestamp()
      ]
    })).catch(() => null);

    await channel.send(toComponentsV2(buildProjectStatusPanel({
      ...queueEntry,
      channelId: queueChannelId,
      productionStatus: queueEntry.productionStatus || null,
      productionStatusLabel: queueEntry.productionStatusLabel || 'Aguardando início'
    }))).catch(() => null);
  }

  const member = await interaction.guild.members.fetch(queueEntry.ownerId).catch(() => null);
  if (member?.user) {
    await sendDmPanel(
      member.user,
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Prazo de produção definido')
        .setDescription(
          `Seu bot **${queueEntry.projectName || 'seu projeto'}** tem previsão para começar a ser produzido em: **${deadline}**.\n\n` +
            'Acompanhe o andamento pelo painel do seu canal de projeto.'
        )
        .setTimestamp()
    );
  }

  await interaction.reply(privateReply(`Prazo definido: ${deadline}.`));
  return true;
}

async function handleSystemPanelSubmit(interaction, setup) {
  const rawValue = interaction.fields.getTextInputValue('value').replace(',', '.').trim();
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    await safeReply(interaction, privateReply('Informe um valor numérico válido.'));
    return true;
  }

  if (interaction.customId === 'panel_price_basic_submit') {
    updateSystemSettings(interaction.guild.id, { prices: { basic: value } });
  } else if (interaction.customId === 'panel_price_premium_submit') {
    updateSystemSettings(interaction.guild.id, { prices: { premium: value } });
  } else if (interaction.customId === 'panel_price_hosting_submit') {
    updateSystemSettings(interaction.guild.id, { prices: { hosting: value } });
  } else {
    return false;
  }

  await publishSalesPanels(interaction.guild, setup);
  await safeReply(interaction, privateReply(`Valor atualizado com sucesso para ${brl(value)}.`));
  return true;
}

async function handleCouponCreateSubmit(interaction, setup) {
  const code = interaction.fields.getTextInputValue('code').trim();
  const percent = Number(interaction.fields.getTextInputValue('percent').replace(',', '.').trim());

  if (!code || code.length < 3) {
    await safeReply(interaction, privateReply('Informe um código de cupom válido.'));
    return true;
  }

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    await safeReply(interaction, privateReply('Informe um percentual entre 1 e 99.'));
    return true;
  }

  setSystemCoupon(interaction.guild.id, {
    active: true,
    code: code.toUpperCase(),
    percent,
    updatedBy: interaction.user.id,
    updatedAt: new Date().toISOString()
  });

  await publishSalesPanels(interaction.guild, setup);
  await safeReply(interaction, privateReply(`Cupom ${code.toUpperCase()} cadastrado com ${percent}% de desconto.`));
  return true;
}

async function handleBoostDiscountSubmit(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode alterar o desconto do boost.'));
    return true;
  }

  const percent = Number(interaction.fields.getTextInputValue('percent').replace(',', '.').trim());
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
    await safeReply(interaction, privateReply('Informe um percentual entre 0 e 99.'));
    return true;
  }

  updateSystemSettings(interaction.guild.id, {
    boost: {
      percent,
      updatedBy: interaction.user.id,
      updatedAt: new Date().toISOString()
    }
  });

  await publishSalesPanels(interaction.guild, setup);
  await safeReply(interaction, privateReply(percent > 0
    ? `Desconto de boost atualizado para ${percent}%. Ele só será aplicado em quem tem boost ativo no servidor.`
    : 'Desconto de boost desativado.'
  ));
  return true;
}

async function handlePixQrSubmit(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode cadastrar QR Code Pix.'));
    return true;
  }

  const qrCodeImageUrl = interaction.fields.getTextInputValue('qrCodeImageUrl').trim();
  const qrCodeText = interaction.fields.getTextInputValue('qrCodeText').trim();
  if (!qrCodeImageUrl && !qrCodeText) {
    await safeReply(interaction, privateReply('Informe pelo menos a URL da imagem do QR Code ou o código Pix copia e cola.'));
    return true;
  }

  updateSystemSettings(interaction.guild.id, {
    payment: {
      mode: 'qr_code',
      qrCodeImageUrl: qrCodeImageUrl || null,
      qrCodeText: qrCodeText || null,
      updatedBy: interaction.user.id,
      updatedAt: new Date().toISOString()
    }
  });

  await safeReply(interaction, privateReply('QR Code Pix cadastrado e modo de pagamento alterado para QR Code manual.'));
  return true;
}

async function handlePixQrUpload(interaction) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode fazer upload do QR Code Pix.'));
    return true;
  }

  if (!interaction.channel?.awaitMessages) {
    await safeReply(interaction, privateReply('Não consegui capturar upload neste canal.'));
    return true;
  }

  await safeReply(interaction, privateReply('Envie a imagem do QR Code Pix neste canal em até 2 minutos. O bot vai salvar o anexo automaticamente.'));

  const collected = await interaction.channel.awaitMessages({
    filter: (message) => message.author.id === interaction.user.id && message.attachments.size > 0,
    max: 1,
    time: 120000
  }).catch(() => null);

  const message = collected?.first();
  const attachment = message?.attachments.find((item) =>
    String(item.contentType || '').startsWith('image/')
      || /\.(png|jpe?g|webp|gif)$/i.test(String(item.name || item.url || ''))
  );

  if (!attachment) {
    await interaction.followUp(privateReply('Nenhuma imagem válida foi enviada dentro do prazo.'));
    return true;
  }

  updateSystemSettings(interaction.guild.id, {
    payment: {
      mode: 'qr_code',
      qrCodeImageUrl: attachment.url,
      updatedBy: interaction.user.id,
      updatedAt: new Date().toISOString()
    }
  });

  await interaction.followUp(privateReply('QR Code Pix salvo por upload e modo de pagamento alterado para QR Code manual.'));
  return true;
}

async function handlePixKeySubmit(interaction, setup) {
  if (!isOwnerRole(interaction.member)) {
    await safeReply(interaction, privateReply('Apenas quem tem o cargo Dono pode cadastrar chave Pix.'));
    return true;
  }

  const pixKey = interaction.fields.getTextInputValue('pixKey').trim();
  const pixKeyLabel = interaction.fields.getTextInputValue('pixKeyLabel').trim();
  if (!pixKey) {
    await safeReply(interaction, privateReply('Informe uma chave Pix válida.'));
    return true;
  }

  updateSystemSettings(interaction.guild.id, {
    payment: {
      mode: 'pix_key',
      pixKey,
      pixKeyLabel: pixKeyLabel || null,
      updatedBy: interaction.user.id,
      updatedAt: new Date().toISOString()
    }
  });

  await safeReply(interaction, privateReply('Chave Pix cadastrada e modo de pagamento alterado para chave Pix manual.'));
  return true;
}

async function restoreDeletedPanel(message) {
  if (restoreSuppression.has(message.channelId)) {
    return false;
  }

  return restoreStaticPanel(message.guild, message.channelId, {
    authorId: message.author?.id,
    botUserId: message.client?.user?.id,
    embeds: message.embeds,
    skipAuthorCheck: false
  });
}

async function restoreStaticPanel(guild, channelId, options = {}) {
  const { authorId = null, botUserId = null, embeds = [], skipAuthorCheck = false } = options;
  if (!guild || (!skipAuthorCheck && authorId !== botUserId)) {
    return false;
  }

  const setup = resolveGuildSetup(guild);
  if (!setup) {
    return false;
  }

  const settings = getSystemSettings(guild.id);
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return false;
  }

  if (setup.channels?.verify === channelId) {
    await replaceStaticPanelMessage(channel, buildVerificationPanel()).catch(() => null);
    return true;
  }

  if (setup.channels?.supportRules === channelId) {
    await replaceStaticPanelMessage(channel, { embeds: buildSupportRulesEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.openTicket === channelId) {
    await replaceStaticPanelMessage(channel, buildTicketPanelPayload()).catch(() => null);
    return true;
  }

  if (setup.channels?.rules === channelId) {
    await replaceStaticPanelMessage(channel, { embeds: buildServerRulesEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.howItWorks === channelId) {
    await replaceStaticPanelMessage(channel, { embeds: buildHowItWorksEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.plans === channelId) {
    await replaceStaticPanelMessage(channel, buildPlanSelectionPanelPayload()).catch(() => null);
    return true;
  }

  if (setup.channels?.buyNow === channelId) {
    await replaceStaticPanelMessage(channel, {
      embeds: [buildPlansEmbeds({ settings })[0]],
      components: buildPlansButtons()
    }).catch(() => null);
    return true;
  }

  if (setup.channels?.promotions === channelId) {
    await replaceStaticPanelMessage(channel, { embeds: [buildPromotionEmbed(settings.retail.active)] }).catch(() => null);
    return true;
  }

  if (setup.channels?.renewPlan === channelId) {
    await replaceStaticPanelMessage(channel, buildRenewPanelPayload()).catch(() => null);
    return true;
  }

  if (setup.channels?.suggestions === channelId) {
    await replaceStaticPanelMessage(channel, buildSuggestionsPanelPayload()).catch(() => null);
    return true;
  }

  if (settings.ui?.systemPanelChannelId === channelId) {
    await replaceStaticPanelMessage(channel, {
      embeds: [buildSystemPanelEmbed(guild)],
      components: buildSystemPanelButtons()
    }).catch(() => null);
    return true;
  }

  if (embeds?.some((embed) => embed?.title === 'Painel de controle do sistema')) {
    await replaceStaticPanelMessage(channel, {
      embeds: [buildSystemPanelEmbed(guild)],
      components: buildSystemPanelButtons()
    }).catch(() => null);
    return true;
  }

  return false;
}

async function handleButton(interaction) {
  if (
    interaction.customId === 'abrir_loja' ||
    interaction.customId === 'tem_cupom' ||
    interaction.customId === 'sem_cupom' ||
    interaction.customId === 'ver_pix' ||
    interaction.customId === 'enviar_comprovante' ||
    interaction.customId === 'voltar_etapa1' ||
    interaction.customId === 'voltar_etapa3' ||
    interaction.customId.startsWith('aprovar_') ||
    interaction.customId.startsWith('recusar_') ||
    interaction.customId === 'fechar_ticket'
  ) {
    return handlePlanButton(interaction);
  }

  if (interaction.customId.startsWith('rating:')) {
    const [, ticketId, stars] = interaction.customId.split(':');
    addRating(interaction.guildId || 'dm', interaction.user.id, Number(stars), ticketId);
    await interaction.reply(privateReply(`Obrigado pela avaliação de ${stars} estrela(s).`));
    return true;
  }

  if (interaction.customId.startsWith('access_unlock:')) {
    await handleAccessUnlockButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('access_recover:')) {
    await handleAccessRecoverButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('access_change:')) {
    await handleAccessChangeButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('hosting_paid:')) {
    await handleHostingSelfPaid(interaction);
    return true;
  }

  if (interaction.customId.startsWith('hosting_unpaid:')) {
    await handleHostingSelfUnpaid(interaction);
    return true;
  }

  if (interaction.customId === 'hosting_access_create') {
    await handleHostingAccessCreateButton(interaction);
    return true;
  }

  const setup = resolveGuildSetup(interaction.guild);
  if (!setup) {
    await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
    return true;
  }

  if (interaction.customId === 'verify_member' || interaction.customId === 'setup_verify') {
    await verifyMember(interaction, setup);
    return true;
  }

  if (interaction.customId.startsWith('panel_')) {
    return handleSystemPanelButton(interaction, setup);
  }

  if (interaction.customId.startsWith('setup_')) {
    return handleSetupButton(interaction);
  }

  if (ticketLabels[interaction.customId]) {
    if (interaction.customId.startsWith('ticket_')) {
      await interaction.showModal(buildTicketReasonModal(interaction.customId));
      return true;
    }

    await openTicket(interaction, setup, interaction.customId);
    return true;
  }

  if (interaction.customId === 'contract_start') {
    await handleContractStart(interaction);
    return true;
  }

  if (interaction.customId === 'coupon_apply') {
    await handleCouponApply(interaction);
    return true;
  }

  if (interaction.customId.startsWith('ticket_')) {
    await handleTicketAction(interaction, setup);
    return true;
  }

  if (interaction.customId.startsWith('queue_') || interaction.customId.startsWith('payment_') || interaction.customId === 'preapproved_delete_channel') {
    await handleQueueAction(interaction, setup);
    return true;
  }

  if (interaction.customId.startsWith('project_deadline:')) {
    await handleProjectDeadlineButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('project_support:')) {
    await handleProjectSupportButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('contract_end:')) {
    await handleContractEndButton(interaction);
    return true;
  }

  if (interaction.customId.startsWith('project_status:')) {
    await handleProjectStatusButton(interaction);
    return true;
  }

  if (interaction.customId === 'suggestion_open') {
    await openSuggestionModal(interaction);
    return true;
  }

  return false;
}

async function handleSelect(interaction) {
  if (interaction.customId === PLAN_SELECT_CUSTOM_ID) {
    return handlePlanSelection(interaction);
  }

  if (interaction.customId === 'panel_tools') {
    const setup = resolveGuildSetup(interaction.guild);
    if (!setup) {
      await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
      return true;
    }

    return handleSystemPanelButton(interaction, setup, interaction.values[0]);
  }

  if (interaction.customId === 'panel_payment_mode') {
    const setup = resolveGuildSetup(interaction.guild);
    if (!setup) {
      await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
      return true;
    }

    if (!isOwnerRole(interaction.member)) {
      await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode alterar o modo de pagamento.'));
      return true;
    }

    const mode = interaction.values?.[0] || 'pagbank';
    const settings = updateSystemSettings(interaction.guild.id, {
      payment: {
        mode,
        updatedAt: new Date().toISOString(),
        updatedBy: interaction.user.id
      }
    });

    await safeUpdate(interaction, {
      content: `Modo de pagamento atualizado para **${paymentModeLabel(settings.payment.mode)}**.`,
      embeds: [],
      components: []
    });
    return true;
  }

  const setup = resolveGuildSetup(interaction.guild);
  if (!setup) {
    await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
    return true;
  }

  if (interaction.customId === 'ticket_tools') {
    const type = interaction.values?.[0];
    if (!ticketLabels[type]) {
      await interaction.reply(privateReply('Selecione um tipo de ticket válido.'));
      return true;
    }

    await interaction.showModal(buildTicketReasonModal(type));
    return true;
  }

  if (interaction.customId === 'panel_hosting_paid_user') {
    await handleHostingAdminUserSelect(interaction, true);
    return true;
  }

  if (interaction.customId === 'panel_hosting_unpaid_user') {
    await handleHostingAdminUserSelect(interaction, false);
    return true;
  }

  if (interaction.customId === 'panel_site_verify_user') {
    await handleDashboardVerificationUserSelect(interaction);
    return true;
  }

  if (interaction.customId === 'panel_client_delete_user') {
    await handleClientDeleteUserSelect(interaction, setup);
    return true;
  }

  if (interaction.customId === 'panel_plan_user') {
    await handleClientPlanUserSelect(interaction);
    return true;
  }

  if (interaction.customId.startsWith('panel_plan_select:')) {
    await handleClientPlanSelect(interaction, setup);
    return true;
  }

  return false;
}

async function handleModal(interaction) {
  if (
    interaction.customId === 'modal_cupom' ||
    interaction.customId === 'modal_comprovante' ||
    interaction.customId === 'modal_recusa'
  ) {
    return handleReceiptModalSubmit(interaction);
  }

  if (interaction.customId.startsWith('access_submit:')) {
    await handleAccessUnlockSubmit(interaction);
    return true;
  }

  if (interaction.customId.startsWith('access_change_submit:')) {
    await handleAccessChangeSubmit(interaction);
    return true;
  }

  if (interaction.customId.startsWith('project_deadline_submit:')) {
    await handleProjectDeadlineSubmit(interaction);
    return true;
  }

  if (interaction.customId.startsWith('contract_end_submit:')) {
    await handleContractEndSubmit(interaction);
    return true;
  }

  if (interaction.customId === 'hosting_access_create_submit') {
    await handleHostingAccessCreateSubmit(interaction);
    return true;
  }

  const setup = resolveGuildSetup(interaction.guild);
  if (!setup) {
    await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
    return true;
  }

  if (interaction.customId.startsWith('ticket_reason:')) {
    const [, type] = interaction.customId.split(':');
    if (!ticketLabels[type]) {
      await interaction.reply(privateReply('Tipo de ticket inválido.'));
      return true;
    }

    const reason = interaction.fields.getTextInputValue('reason').trim();
    await openTicket(interaction, setup, type, reason);
    return true;
  }

  if (interaction.customId === 'suggestion_submit') {
    await handleSuggestionSubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'coupon_submit') {
    await handleCouponSubmit(interaction);
    return true;
  }

  if (interaction.customId === 'panel_coupon_create_submit') {
    await handleCouponCreateSubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'panel_boost_discount_submit') {
    await handleBoostDiscountSubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'panel_pix_qr_submit') {
    await handlePixQrSubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'panel_pix_key_submit') {
    await handlePixKeySubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'panel_hosting_paid_submit') {
    await handleHostingAdminSubmit(interaction, setup, true);
    return true;
  }

  if (interaction.customId === 'panel_hosting_unpaid_submit') {
    await handleHostingAdminSubmit(interaction, setup, false);
    return true;
  }

  if (interaction.customId === 'panel_price_basic_submit' || interaction.customId === 'panel_price_premium_submit' || interaction.customId === 'panel_price_hosting_submit') {
    await handleSystemPanelSubmit(interaction, setup);
    return true;
  }

  if (interaction.customId === 'contract_submit') {
    await handleContractSubmit(interaction, setup);
    return true;
  }

  return false;
}

module.exports = {
  handleButton,
  handleSelect,
  handleModal,
  buildSystemPanelButtons,
  buildSystemPanelEmbed,
  publishHostingReminder,
  revokeHostingAccess,
  deleteHostingAccess,
  restoreDeletedPanel,
  restoreStaticPanel,
  suppressPanelRestore,
  sendRatingRequest
};
