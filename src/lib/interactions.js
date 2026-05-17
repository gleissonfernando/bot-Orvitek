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
const {
  addRating,
  addSuggestion,
  createTicket,
  deleteClient,
  getGuildSetup,
  getQueueEntry,
  getQueuePosition,
  getTicketByChannel,
  createContract,
  getContract,
  getClient,
  getSystemSettings,
  clearSystemCoupon,
  getHostingCycleKey,
  getHostingGraceDeadline,
  getNextHostingDueDate,
  listClients,
  setSystemCoupon,
  updateTicket,
  updateSystemSettings,
  upsertClient,
  upsertQueueEntry
} = require('./store');
const { runSetup } = require('./setupRunner');
const {
  buildAccessApprovalDm,
  buildAccessUnlockedDm,
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
const { buildPlansButtons, buildPlansEmbeds, buildPromotionEmbed, getPlanPricing } = require('./plans');
const { replacePanelMessage } = require('./panelUtils');
const { buildRenewPanelPayload, buildSuggestionsPanelPayload, buildTicketPanelPayload } = require('./staticPanels');

const PROJECT_ACCESS_CATEGORY_ID = process.env.PROJECT_ACCESS_CATEGORY_ID || '1505195763469127770';
const HOSTING_LOG_CHANNEL_ID = process.env.HOSTING_LOG_CHANNEL_ID || '1505275946721087730';
const PAYMENT_REJECT_DELETE_MS = 3 * 60 * 60 * 1000;

const restoreSuppression = new Set();

function suppressPanelRestore(channelId, ttlMs = 10000) {
  restoreSuppression.add(channelId);
  setTimeout(() => restoreSuppression.delete(channelId), ttlMs).unref?.();
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
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
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
    await interaction.update(payload);
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

function staffOverwrites(setup) {
  return staffRoleKeys
    .filter((key) => setup.roles[key])
    .map((key) => ({
      id: setup.roles[key],
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

async function addConfiguredRole(member, setup, key, fallbackName) {
  const role = getConfiguredRole(member, setup, key, fallbackName);
  if (role) {
    await member.roles.add(role).catch(() => null);
  }
}

async function removeConfiguredRole(member, setup, key, fallbackName) {
  const role = getConfiguredRole(member, setup, key, fallbackName);
  if (role && member.roles.cache.has(role.id)) {
    await member.roles.remove(role).catch(() => null);
  }
}

function purchaseTypes(type) {
  return ['plan_basic', 'plan_pro', 'plan_lifetime', 'plan_paid'].includes(type);
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

function generateAccessKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];

  for (let segment = 0; segment < 4; segment += 1) {
    let value = '';
    for (let index = 0; index < 5; index += 1) {
      const random = crypto.randomBytes(1)[0];
      value += alphabet[random % alphabet.length];
    }
    segments.push(value);
  }

  return `HST-${segments.join('-')}`;
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
  return buildContractButton();
}

function buildPreApprovedPanel(contract) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Pré aprovado')
        .setDescription(
          'Contrato assinado. Agora o cliente cadastra a chave de acesso, entra na fila e aguarda a análise do pagamento.'
        )
        .addFields(
          { name: 'Cliente', value: contract.fullName || contract.userTag || 'não informado', inline: true },
          { name: 'Projeto', value: contract.projectName || 'não informado', inline: true },
          { name: 'Status', value: 'Aguardando chave e pagamento', inline: true }
        )
        .setFooter({ text: 'Somente o cliente usa os botões de chave e fila. A aprovação/recusa é da administração.' })
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hosting_access_create').setLabel('Cadastrar chave de acesso').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('queue_join').setLabel('Adicionar à fila').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('payment_approve').setLabel('Pagamento aprovado').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('payment_reject').setLabel('Pagamento recusado').setStyle(ButtonStyle.Danger),
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
          .setStyle(ButtonStyle.Success)
      )
    ]
  };
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
  const clients = listClients(guild.id, null);
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
        name: 'Hospedagem',
        value:
          `Pendentes: **${hostingPending}**\n` +
          `Suspensos: **${hostingSuspended}**\n` +
          `Excluídos: **${hostingDeleted}**`,
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
          { label: 'Hospedagem paga', value: 'panel_hosting_paid', description: 'Marcar hospedagem de cliente como paga.' },
          { label: 'Hospedagem vencida', value: 'panel_hosting_unpaid', description: 'Marcar hospedagem de cliente como vencida.' },
          { label: 'Ativar/Desativar Promoção', value: 'panel_toggle_promo', description: 'Alternar o status da promoção.' },
          { label: 'Republicar Painéis', value: 'panel_refresh_sales', description: 'Atualizar painéis com os valores atuais.' },
          { label: 'Apagar cadastro', value: 'panel_client_delete', description: 'Remover o cadastro de um cliente.' }
        )
    )
  ];
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

async function publishSalesPanels(guild, setup, options = {}) {
  const { includePromotions = true } = options;
  const settings = getSystemSettings(guild.id);
  const planEmbeds = buildPlansEmbeds({ settings });
  const plansChannel = setup?.channels?.plans ? await guild.channels.fetch(setup.channels.plans).catch(() => null) : null;
  const promotionsChannel = setup?.channels?.promotions ? await guild.channels.fetch(setup.channels.promotions).catch(() => null) : null;
  const buyNowChannel = setup?.channels?.buyNow ? await guild.channels.fetch(setup.channels.buyNow).catch(() => null) : null;

  if (plansChannel?.isTextBased()) {
    await replacePanelMessage(plansChannel, {
      embeds: planEmbeds
    });
  }

  if (includePromotions && promotionsChannel?.isTextBased()) {
    await replacePanelMessage(promotionsChannel, {
      embeds: [buildPromotionEmbed(settings.retail.active)]
    });
  }

  if (buyNowChannel?.isTextBased()) {
    await replacePanelMessage(buyNowChannel, {
      embeds: [planEmbeds[0]],
      components: buildPlansButtons()
    }).catch(() => null);
  }
}

async function replaceConfiguredPanel(guild, channelId, payload) {
  if (!channelId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  await replacePanelMessage(channel, payload).catch(() => null);
  return true;
}

async function publishAllConfiguredPanels(guild, setup) {
  const settings = getSystemSettings(guild.id);
  let published = 0;

  if (await replaceConfiguredPanel(guild, setup.channels?.verify, buildVerificationPanel())) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.rules, { embeds: buildServerRulesEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.howItWorks, { embeds: buildHowItWorksEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.supportRules, { embeds: buildSupportRulesEmbeds() })) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.plans, { embeds: buildPlansEmbeds({ settings }) })) published += 1;
  if (
    await replaceConfiguredPanel(guild, setup.channels?.buyNow, {
      embeds: [buildPlansEmbeds({ settings })[0]],
      components: buildPlansButtons()
    })
  ) published += 1;
  if (await replaceConfiguredPanel(guild, setup.channels?.promotions, { embeds: [buildPromotionEmbed(settings.retail.active)] })) published += 1;
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
          new ButtonBuilder().setCustomId('queue_join').setLabel('Adicionar à fila').setStyle(ButtonStyle.Primary),
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
        await promotionsChannel.send({
          content: `<@&${roleId}>`,
          allowedMentions: { roles: [roleId] },
          embeds: [buildPromotionEmbed(true)]
        }).catch(() => null);
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
    panel_coupon_create: buildCouponModal(settings.coupon)
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
    .setMinLength(8)
    .setMaxLength(64);
  const confirmPassword = new TextInputBuilder()
    .setCustomId('confirmPassword')
    .setLabel('Confirmar senha')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
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
    await channel.send({ embeds: [embed] }).catch(() => null);
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
    await member.user.send({
      embeds: [buildHostingOverdueDm({ guildName: guild.name, projectName: clientRecord.projectName })]
    }).catch(() => null);
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

  if (channel?.isTextBased() && member) {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false
    }).catch(() => null);
  }

  if (channel?.deletable) {
    await channel.delete('Chave excluída por inadimplência').catch(() => null);
  }

  if (ticketChannel?.deletable && ticketChannel.id !== channel?.id) {
    await ticketChannel.delete('Pagamento recusado sem regularização em 3 horas').catch(() => null);
  }

  upsertClient(guild.id, clientRecord.userId, {
    hostingStatus: 'deleted',
    accessGranted: false,
    accessKey: null,
    accessPasswordHash: null,
    accessPasswordSalt: null,
    hostingDeletedAt: new Date().toISOString(),
    hostingDeletedBy: options.byUserId || null,
    hostingReminderMessageId: null,
    paymentTicketChannelId: null,
    paymentRejectDeleteAt: null
  });

  if (member?.user) {
    const reason = options.reason || 'O prazo de tolerância da hospedagem terminou.';
    await member.user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('❌ Acesso removido permanentemente')
          .setDescription(
            `${reason} Projeto: **${clientRecord.projectName || 'seu projeto'}**.\n\n` +
              'Sua chave foi excluída do sistema e o processo precisa ser refeito do zero.'
          )
      ]
    }).catch(() => null);
  }

  await logHostingEvent(
    guild,
    new EmbedBuilder()
      .setColor(colors.red)
      .setTitle('Chave excluída permanentemente')
      .addFields(
        { name: 'Cliente', value: clientRecord.userTag || clientRecord.userId, inline: true },
        { name: 'Projeto', value: clientRecord.projectName || 'não informado', inline: true },
        { name: 'Vencimento', value: clientRecord.hostingDueAt || 'não informado', inline: true },
        { name: 'Exclusão', value: new Date().toISOString(), inline: true }
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

  const message = await channel.send(panel).catch(() => null);
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
  let channel = guild.channels.cache.find((entry) => entry.name === channelName && entry.type === ChannelType.GuildText);

  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: PROJECT_ACCESS_CATEGORY_ID || setup.categories.customers || null,
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
  const unverified = process.env.UNVERIFIED_ROLE_ID || setup.roles.unverified;
  const futureClient = process.env.FUTURE_CLIENT_ROLE_ID || setup.roles.futureClient || setup.roles.visitor;

  try {
    if (unverified && interaction.member.roles.cache.has(unverified)) {
      await interaction.member.roles.remove(unverified);
    }

    const role = await interaction.guild.roles.fetch(futureClient).catch(() => null);

    if (!role) {
      await safeReply(interaction, privateReply('⚠️ Ocorreu um erro ao processar sua verificação. Por favor, entre em contato com um administrador.'));
      return;
    }

    await interaction.member.roles.add(futureClient);
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

  const supportCategoryId = setup.categories.supportCategory;
  const channel = await interaction.guild.channels.create({
    name: `suporte-${slug}-${username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: supportCategoryId || null,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...staffOverwrites(setup)
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

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [
      (() => {
        const embed = new EmbedBuilder()
        .setColor(colors.blue)
        .setTitle(`Ticket #${ticket.id}`)
        .setDescription(
          purchaseTypes(type)
            ? 'Envie o comprovante neste canal. Primeiro você cria a chave de acesso, depois envia o comprovante com a chave visível.\n\nA ativação do bot só é feita depois que o comprovante for aprovado. Para entrar na fila de produção, siga as instruções do atendimento e aguarde a aprovação. Cada bot tem prazo médio de entrega de até 5 dias após aprovação na fila.'
            : 'A equipe irá atender você em breve.'
        )
        .addFields(
          { name: 'Precisa de', value: ticketLabels[type] || type, inline: true },
          { name: 'Cliente', value: interaction.user.tag, inline: true },
          { name: 'Canal', value: `Suporte | ${interaction.user.username}` },
          ...(reason ? [{ name: 'Motivo', value: reason.slice(0, 1000) }] : []),
          ...(purchaseTypes(type)
            ? [
                { name: 'Comprovante', value: 'Deve ser enviado aqui no canal.', inline: true },
                { name: 'Entrada na fila', value: 'Conforme instruções do atendimento.', inline: true },
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
  });

  if (purchaseTypes(type)) {
    await channel.send({
      embeds: [buildContractIntroEmbed(ticket)],
      components: buildContractOnlyActions()
    });
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
    await interaction.reply({ content: `Ticket assumido por ${interaction.user}.` });
    return;
  }

  if (interaction.customId === 'ticket_escalate') {
    const reports = setup.channels.reports ? `<#${setup.channels.reports}>` : 'relatórios';
    await interaction.reply({ content: `Ticket escalado para ${reports}.` });
    return;
  }

  updateTicket(interaction.channelId, { status: 'closed', closedAt: new Date().toISOString() });
  const member = await interaction.guild.members.fetch(ticket.ownerId).catch(() => null);
  if (member) {
    await sendRatingRequest(member.user, ticket.id);
  }
  await interaction.reply({ content: 'Ticket fechado. Este canal será removido em 10 segundos.' });
  setTimeout(() => interaction.channel.delete('Ticket fechado').catch(() => null), 10000);
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

  if (!getContract(interaction.channelId)) {
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
      await interaction.reply(privateReply('Crie a chave de acesso antes de entrar na fila de pagamento.'));
      return;
    }

    const position = getQueuePosition(interaction.guild.id, interaction.channelId);
    const settings = getSystemSettings(interaction.guild.id);
    const pricing = getPlanPricing(ticket.type, settings, queueEntry?.couponCode || null);
    upsertQueueEntry(interaction.channelId, {
      guildId: interaction.guild.id,
      ownerId: ticket.ownerId,
      ownerTag: ticket.ownerTag,
      plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
      status: 'waiting_approval',
      basePrice: pricing.base,
      finalPrice: pricing.final,
      couponCode: pricing.couponMatches ? pricing.coupon.code : null,
      couponPercent: pricing.couponMatches ? pricing.coupon.percent : 0,
      requestedAt: new Date().toISOString()
    });

    await interaction.reply(privateReply({
      content:
        `${interaction.user}, sua solicitação de entrada na fila foi registrada.\n\n` +
        `Clientes na frente no momento: **${position.ahead}**.\n` +
        `Para ser aprovado na fila, envie aqui o comprovante de pagamento conforme as instruções do atendimento.` +
        (pricing.couponMatches ? `\nCupom aplicado: **${pricing.coupon.code}** (-${pricing.coupon.percent}%).` : '')
    }));
    return;
  }

  if (!isOwnerRole(interaction.member)) {
    await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode aprovar ou alterar a etapa da fila.'));
    return;
  }

  if (interaction.customId === 'preapproved_delete_channel') {
    updateTicket(interaction.channelId, {
      status: 'deleted_preapproved',
      closedAt: new Date().toISOString(),
      closedBy: interaction.user.id
    });
    upsertQueueEntry(interaction.channelId, {
      status: 'deleted_preapproved',
      deletedAt: new Date().toISOString(),
      deletedBy: interaction.user.id
    });

    await interaction.reply('Canal será apagado em 5 segundos.');
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

    await interaction.reply(
      `Pagamento recusado. Se o pagamento não for regularizado, este atendimento será apagado automaticamente em 3 horas: <t:${Math.floor(deleteAt.getTime() / 1000)}:R>.`
    );
    return;
  }

  if (interaction.customId === 'queue_approve' || interaction.customId === 'payment_approve') {
    const queueEntry = getQueueEntry(interaction.channelId);
    const contract = getContract(interaction.channelId);
    const projectName = queueEntry?.projectName || contract?.projectName || ticket.ownerTag;
    const accessKey = queueEntry?.accessKey;
    const accessPasswordHash = queueEntry?.accessPasswordHash;
    const accessPasswordSalt = queueEntry?.accessPasswordSalt;

    if (!accessKey || !accessPasswordHash || !accessPasswordSalt) {
      await interaction.reply(privateReply('O cliente precisa criar a chave de acesso antes da aprovação.'));
      return;
    }

    const projectChannel = await ensureProjectChannel(interaction.guild, setup, member.user, projectName);
    const dueAt = getNextHostingDueDate();
    const hostingCycle = getHostingCycleKey(dueAt);
    upsertQueueEntry(interaction.channelId, {
      guildId: interaction.guild.id,
      ownerId: ticket.ownerId,
      ownerTag: ticket.ownerTag,
      plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: interaction.user.id,
      couponCode: queueEntry?.couponCode || null,
      couponPercent: queueEntry?.couponPercent || 0,
      finalPrice: queueEntry?.finalPrice || null,
      projectName,
      projectChannelId: projectChannel.id,
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
      plan: ticket.type === 'plan_pro' ? 'premium' : ticket.type === 'plan_basic' ? 'basico' : ticket.type,
      projectName,
      projectChannelId: projectChannel.id,
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
      activatedBy: interaction.user.id
    });
    await addConfiguredRole(member, setup, 'queue', 'Na Fila');
    const position = getQueuePosition(interaction.guild.id, interaction.channelId);
    await projectChannel.send(buildProjectAccessPanel({ ...queueEntry, channelId: interaction.channelId, projectName, accessKey })).catch(() => null);
    await interaction.reply(`Pagamento aprovado. Canal do projeto criado: ${projectChannel}. Posição atual: **${position.position}**. Prazo médio: até 5 dias.`);
    const dmPayload = buildAccessApprovalDm({
      guildName: interaction.guild.name,
      projectName,
      accessKey,
      channelId: interaction.channelId,
      projectChannelId: projectChannel.id
    });
    await sendDmPanel(member.user, dmPayload.embed, [], dmPayload.components);
    return;
  }

  if (interaction.customId === 'queue_development') {
    upsertQueueEntry(interaction.channelId, {
      status: 'development',
      developmentAt: new Date().toISOString(),
      developmentBy: interaction.user.id
    });
    await removeConfiguredRole(member, setup, 'queue', 'Na Fila');
    await addConfiguredRole(member, setup, 'development', 'Bot em Desenvolvimento');
    await interaction.reply(`${member}, seu bot entrou em **desenvolvimento**. A equipe vai atualizar este canal conforme avançar.`);
    return;
  }

  upsertQueueEntry(interaction.channelId, {
    status: 'ready',
    readyAt: new Date().toISOString(),
    readyBy: interaction.user.id
  });
  await removeConfiguredRole(member, setup, 'development', 'Bot em Desenvolvimento');
  await removeConfiguredRole(member, setup, 'futureClient', 'Futuro Cliente');
  await addConfiguredRole(member, setup, 'active', 'Cliente Ativo');

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

  await interaction.reply(
    `${member}, seu bot está **pronto**.\n\n` +
      'Por favor, teste o projeto e envie um feedback neste canal dizendo se está tudo certo ou se precisa de algum ajuste.'
  );
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
  await interaction.deferReply({ ephemeral: true });

  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.editReply('Este canal não possui um contrato de compra pendente.');
    return;
  }

  if (ticket.ownerId !== interaction.user.id && !isOwnerRole(interaction.member)) {
    await interaction.editReply('Apenas o cliente deste atendimento pode assinar o contrato.');
    return;
  }

  const settings = getSystemSettings(interaction.guild.id);
  const queueEntry = getQueueEntry(interaction.channelId);
  const pricing = getPlanPricing(ticket.type, settings, queueEntry?.couponCode || null);

  const contract = createContract(interaction.channelId, {
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    planType: ticket.type,
    fullName: interaction.fields.getTextInputValue('fullName'),
    cpf: interaction.fields.getTextInputValue('cpf'),
    email: interaction.fields.getTextInputValue('email'),
    phoneAndPayment: interaction.fields.getTextInputValue('phoneAndPayment'),
    projectName: interaction.fields.getTextInputValue('projectName'),
    ip: 'não disponível no Discord',
    couponCode: queueEntry?.couponCode || null,
    couponPercent: queueEntry?.couponPercent || 0,
    basePrice: pricing.base,
    finalPrice: pricing.final,
    entryPrice: pricing.final / 2,
    remainingPrice: pricing.final / 2
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
    signedAt: contract.signedAt
  });

  const pdfPath = await generateContractPdf(contract);
  const pdfAttachment = new AttachmentBuilder(pdfPath, { name: `contrato-${contract.id}.pdf` });
  const dmSent = await sendDmPanel(interaction.user, buildSignedContractEmbed(contract), [pdfAttachment]);

  const logAttachment = new AttachmentBuilder(pdfPath, { name: `contrato-${contract.id}.pdf` });
  const contractLogChannelId = process.env.CONTRACT_LOG_CHANNEL_ID;
  if (contractLogChannelId) {
    const logChannel = await interaction.guild.channels.fetch(contractLogChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel.send({
        embeds: [buildSignedContractEmbed(contract)],
        files: [logAttachment]
      }).catch(() => null);
    }
  }

  await purgeChannel(interaction.channel);

  await interaction.channel.send(buildPreApprovedPanel(contract));

  await interaction.editReply(
    dmSent
      ? 'Contrato assinado. O PDF foi enviado no seu privado.'
      : 'Contrato assinado. Não consegui enviar DM, mas o documento foi gerado e a etapa foi liberada.'
  );
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
    .send({
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
    })
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
    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.purple)
          .setTitle(`Sugestão #${suggestion.id}`)
          .setDescription(content)
          .addFields({ name: 'Enviada por', value: interaction.user.tag })
          .setTimestamp()
      ]
    });
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

  if (!coupon || String(coupon.code).trim().toLowerCase() !== code.toLowerCase()) {
    await safeReply(interaction, privateReply('Cupom inválido ou indisponível.'));
    return true;
  }

  const pricing = getPlanPricing(ticket.type, settings, code);
  upsertQueueEntry(interaction.channelId, {
    couponCode: coupon.code,
    couponPercent: coupon.percent,
    basePrice: pricing.base,
    finalPrice: pricing.final
  });

  await safeReply(
    interaction,
    privateReply(`Cupom aplicado com sucesso. Novo valor do plano: ${brl(pricing.final)}.`)
  );
  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('Cupom aplicado')
        .setDescription(`O cupom **${coupon.code}** foi aplicado com **${coupon.percent}% OFF**.`)
        .addFields(
          { name: 'Valor original', value: brl(pricing.base), inline: true },
          { name: 'Valor com desconto', value: brl(pricing.final), inline: true }
        )
    ]
  }).catch(() => null);
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
    await interaction.reply({ content: 'Não encontrei uma cobrança ativa para você.' });
    return true;
  }

  upsertClient(interaction.guild.id, interaction.user.id, {
    hostingPaymentStatus: 'awaiting_review',
    hostingLastUserReportAt: new Date().toISOString()
  });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.user) {
    await member.user.send({
      embeds: [buildHostingPaymentInstructionDm({ guildName: interaction.guild.name, projectName: clientRecord.projectName })]
    }).catch(() => null);
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

  await interaction.reply({ content: 'Confirmação recebida. Envie o comprovante no ticket para validação.' });
  return true;
}

async function handleHostingSelfUnpaid(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const clientRecord = findClientByProjectChannel(interaction.guild.id, channelId);
  if (!clientRecord || clientRecord.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Não encontrei uma cobrança ativa para você.' });
    return true;
  }

  await revokeHostingAccess(interaction.guild, clientRecord, {
    reason: 'Cliente informou falta de pagamento',
    byUserId: interaction.user.id
  });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.user) {
    await member.user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.red)
          .setTitle('Acesso interrompido')
          .setDescription(
            'Seu acesso foi interrompido por falta de pagamento.\n\n' +
              'Abra um ticket para regularizar a hospedagem e recuperar o acesso dentro do prazo de tolerância.'
          )
      ]
    }).catch(() => null);
  }

  await interaction.reply({ content: 'Acesso interrompido. Você receberá as instruções por DM.' });
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
    dmSent = await user.send({ embeds: [goodbyeEmbed] }).then(() => true).catch(() => false);
  }

  if (!dmSent && projectChannel?.isTextBased()) {
    await projectChannel.send({ content: `<@${userId}>`, embeds: [goodbyeEmbed] }).catch(() => null);
  }

  if (projectChannel?.deletable) {
    setTimeout(() => projectChannel.delete('Cadastro do cliente apagado pelo painel').catch(() => null), dmSent ? 0 : 15000);
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
  return true;
}

async function handleHostingAccessCreateSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || !purchaseTypes(ticket.type)) {
    await interaction.editReply('Este canal não está registrado como compra.');
    return true;
  }

  if (ticket.ownerId !== interaction.user.id) {
    await interaction.editReply('Apenas o cliente deste atendimento pode criar a chave de acesso.');
    return true;
  }

  const botName = interaction.fields.getTextInputValue('botName').trim();
  const password = interaction.fields.getTextInputValue('password').trim();
  const confirmPassword = interaction.fields.getTextInputValue('confirmPassword').trim();

  if (password.length < 8) {
    await interaction.editReply('A senha precisa ter no mínimo 8 caracteres.');
    return true;
  }

  if (password !== confirmPassword) {
    await interaction.editReply('A confirmação da senha não confere.');
    return true;
  }

  let accessKey = generateAccessKey();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!findClientByAccessKey(interaction.guild.id, accessKey)) break;
    accessKey = generateAccessKey();
  }

  const { salt, hash } = hashHostingPassword(password);
  const queueEntry = getQueueEntry(interaction.channelId) || {};
  const projectName = botName || queueEntry.projectName || ticket.ownerTag;
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

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('🔑 Chave criada')
        .setDescription(
          `A chave do projeto **${projectName}** foi criada.\n\n` +
            'Agora envie o comprovante no canal com a chave visível. A equipe fará a aprovação em seguida.'
        )
        .addFields(
          { name: 'Chave de acesso', value: `\`${accessKey}\``, inline: true },
          { name: 'Próximo passo', value: 'Enviar o comprovante de pagamento.', inline: true }
        )
        .setTimestamp()
    ]
  }).catch(() => null);

  await interaction.editReply(`Chave criada com sucesso: \`${accessKey}\`. O cliente recebeu a orientação por DM.`);
  return true;
}

async function handleAccessUnlockButton(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Não encontrei um acesso pendente para você.' });
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
    .setMinLength(8)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(key));
  modal.addComponents(new ActionRowBuilder().addComponents(password));
  await interaction.showModal(modal);
  return true;
}

async function handleAccessUnlockSubmit(interaction) {
  const [, channelId] = interaction.customId.split(':');
  const queueEntry = getQueueEntry(channelId);

  if (!queueEntry || queueEntry.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Não encontrei um acesso pendente para você.' });
    return true;
  }

  const key = interaction.fields.getTextInputValue('key').trim();
  const password = interaction.fields.getTextInputValue('password').trim();

  if (password.length < 8) {
    await interaction.reply({ content: 'A senha precisa ter no mínimo 8 caracteres.' });
    return true;
  }

  const matchesKey = String(queueEntry.accessKey || '').trim().toLowerCase() === key.toLowerCase();
  const matchesPassword =
    queueEntry.accessPasswordHash && queueEntry.accessPasswordSalt
      ? verifyHostingPassword(password, queueEntry.accessPasswordSalt, queueEntry.accessPasswordHash)
      : String(queueEntry.accessPassword || '') === password;

  if (!matchesKey || !matchesPassword) {
    await interaction.reply({ content: 'Chave ou senha incorreta. Verifique a DM com as instruções e tente novamente.' });
    return true;
  }

  const guild = await interaction.client.guilds.fetch(queueEntry.guildId).catch(() => null);
  if (!guild) {
    await interaction.reply({ content: 'Não consegui localizar o servidor deste acesso.' });
    return true;
  }

  const setup = resolveGuildSetup(guild);
  const projectChannelId = queueEntry.projectChannelId || channelId;
  const channel = await guild.channels.fetch(projectChannelId).catch(() => null);
  if (!setup || !channel?.isTextBased()) {
    await interaction.reply({ content: 'Não consegui localizar o canal do projeto.' });
    return true;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: 'Não consegui localizar sua conta no servidor.' });
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
    accessGrantedBy: interaction.user.id
  });

  upsertClient(guild.id, interaction.user.id, {
    status: 'active',
    projectChannelId,
    accessGrantedAt: new Date().toISOString(),
    hostingStatus: 'current',
    hostingPaymentStatus: 'paid',
    hostingPaidAt: new Date().toISOString()
  });

  await interaction.reply({ content: 'Acesso liberado com sucesso. Você já pode ver o canal do projeto.' });
  await sendDmPanel(
    interaction.user,
    buildAccessUnlockedDm({
      guildName: guild.name,
      projectName: queueEntry.projectName || 'seu projeto',
      channelName: `<#${projectChannelId}>`
    })
  );

  await channel.send(buildProjectDeadlinePanel({ ...queueEntry, channelId })).catch(() => null);
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.default)
        .setTitle('✅ Acesso liberado')
        .setDescription(`<@${interaction.user.id}> agora pode visualizar este canal.`)
        .setTimestamp()
    ]
  }).catch(() => null);

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
    await channel.send({
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
    }).catch(() => null);
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
    await replacePanelMessage(channel, buildVerificationPanel()).catch(() => null);
    return true;
  }

  if (setup.channels?.supportRules === channelId) {
    await replacePanelMessage(channel, { embeds: buildSupportRulesEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.openTicket === channelId) {
    await replacePanelMessage(channel, buildTicketPanelPayload()).catch(() => null);
    return true;
  }

  if (setup.channels?.rules === channelId) {
    await replacePanelMessage(channel, { embeds: buildServerRulesEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.howItWorks === channelId) {
    await replacePanelMessage(channel, { embeds: buildHowItWorksEmbeds() }).catch(() => null);
    return true;
  }

  if (setup.channels?.plans === channelId) {
    await replacePanelMessage(channel, {
      embeds: buildPlansEmbeds({ settings })
    }).catch(() => null);
    return true;
  }

  if (setup.channels?.buyNow === channelId) {
    await replacePanelMessage(channel, {
      embeds: [buildPlansEmbeds({ settings })[0]],
      components: buildPlansButtons()
    }).catch(() => null);
    return true;
  }

  if (setup.channels?.promotions === channelId) {
    await replacePanelMessage(channel, { embeds: [buildPromotionEmbed(settings.retail.active)] }).catch(() => null);
    return true;
  }

  if (setup.channels?.renewPlan === channelId) {
    await replacePanelMessage(channel, buildRenewPanelPayload()).catch(() => null);
    return true;
  }

  if (setup.channels?.suggestions === channelId) {
    await replacePanelMessage(channel, buildSuggestionsPanelPayload()).catch(() => null);
    return true;
  }

  if (settings.ui?.systemPanelChannelId === channelId) {
    await replacePanelMessage(channel, {
      embeds: [buildSystemPanelEmbed(guild)],
      components: buildSystemPanelButtons()
    }).catch(() => null);
    return true;
  }

  if (embeds?.some((embed) => embed?.title === 'Painel de controle do sistema')) {
    await replacePanelMessage(channel, {
      embeds: [buildSystemPanelEmbed(guild)],
      components: buildSystemPanelButtons()
    }).catch(() => null);
    return true;
  }

  return false;
}

async function handleButton(interaction) {
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

  if (interaction.customId === 'suggestion_open') {
    await openSuggestionModal(interaction);
    return true;
  }

  return false;
}

async function handleSelect(interaction) {
  if (interaction.customId === 'panel_tools') {
    const setup = resolveGuildSetup(interaction.guild);
    if (!setup) {
      await interaction.reply(privateReply('O servidor ainda não foi configurado com /ativar.'));
      return true;
    }

    return handleSystemPanelButton(interaction, setup, interaction.values[0]);
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

  if (interaction.customId === 'panel_client_delete_user') {
    await handleClientDeleteUserSelect(interaction, setup);
    return true;
  }

  return false;
}

async function handleModal(interaction) {
  if (interaction.customId.startsWith('access_submit:')) {
    await handleAccessUnlockSubmit(interaction);
    return true;
  }

  if (interaction.customId.startsWith('project_deadline_submit:')) {
    await handleProjectDeadlineSubmit(interaction);
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
