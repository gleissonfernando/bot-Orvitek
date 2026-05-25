const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const path = require('node:path');
const { getGuildSetup, getSystemSettings } = require('./store');

const PLAN_SELECT_CUSTOM_ID = 'escolher_plano';
const SALES_PANEL_COLOR = 0x5865f2;
const PAYMENT_COLOR = 0x57f287;
const PIX_COLOR = 0xfee75c;
const ERROR_COLOR = 0xff4757;
const DEFAULT_SUPPORT_ROLE_ID = '1505184193766752386';
const COMPONENTS_V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL_COMPONENTS_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const SALES_BANNER_FILE_NAME = 'orvitek-bots-banner.png';
const SALES_BANNER_PATH = path.join(__dirname, '..', '..', 'assets', SALES_BANNER_FILE_NAME);
const SALES_BANNER_URL = `attachment://${SALES_BANNER_FILE_NAME}`;

const selecaoMap = new Map();
const ticketMap = new Map();
const recusaMap = new Map();

const cupons = {
  PROMO20: { desconto: 20, tipo: 'porcentagem' },
  VIP10: { desconto: 10, tipo: 'fixo' }
};

const planTemplates = [
  {
    id: 'basico',
    buttonId: 'plan_basic',
    emoji: '🌱',
    name: 'Plano Básico',
    priceKey: 'basic',
    benefits: [
      'Comandos essenciais para começar',
      'Painel simples com botões',
      'Boas-vindas, avisos e logs básicos',
      'Configuração inicial inclusa'
    ]
  },
  {
    id: 'profissional',
    buttonId: 'plan_pro',
    emoji: '🚀',
    name: 'Plano Profissional',
    priceKey: 'premium',
    benefits: [
      'Tudo do Básico',
      'Sistema de tickets e suporte',
      'Automações avançadas e relatórios',
      'Painel completo para operação'
    ]
  },
  {
    id: 'vitalicio',
    buttonId: 'plan_lifetime',
    emoji: '👑',
    name: 'Plano Vitalício',
    priceKey: 'lifetime',
    benefits: [
      'Tudo do Profissional',
      'Acesso vitalício ao bot contratado',
      'Ajustes prioritários de implantação',
      'Suporte estendido após entrega'
    ]
  },
  {
    id: 'fivem_fac',
    buttonId: 'plan_fivem_fac',
    emoji: '🏙️',
    name: 'Plano FiveM FAC',
    priceKey: 'fivemFac',
    benefits: [
      'Bot personalizado para facção FiveM',
      'Painel de recrutamento e registro',
      'Sistema de tickets para membros e suporte',
      'Hierarquia de cargos da facção',
      'Logs de ações e controle interno',
      'Canais e permissões organizados',
      'Configuração inicial no seu servidor'
    ]
  },
  {
    id: 'monthly',
    buttonId: 'plan_monthly',
    emoji: '📅',
    name: 'Plano Mensal',
    priceKey: 'monthly',
    benefits: [
      'Pagamento mensal',
      'Hospedagem inclusa',
      'Aceita cupom ativo',
      'Contrato e Pix no ticket',
      'Categoria Plano Mensal',
      'Chave de acesso e codigo apos criar senha'
    ]
  }
];

function setupForGuild(guildId) {
  return getGuildSetup(guildId) || {};
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function resolveGuildId(guildId) {
  return guildId || process.env.GUILD_ID || '';
}

function withCurrentPrice(plan, prices) {
  const price = Number(prices?.[plan.priceKey] || 0);
  return {
    ...plan,
    price,
    priceLabel: plan.id === 'monthly' ? `${formatMoney(price)}/mes` : `${formatMoney(price)} unico`
  };
}

function getPlans(guildId = null, planIds = null) {
  const settings = getSystemSettings(resolveGuildId(guildId));
  const displayOrder = ['basico', 'profissional', 'fivem_fac', 'monthly', 'vitalicio'];
  const allowedPlanIds = Array.isArray(planIds) && planIds.length ? new Set(planIds) : null;
  return planTemplates
    .filter((plan) => !allowedPlanIds || allowedPlanIds.has(plan.id))
    .map((plan) => withCurrentPrice(plan, settings.prices))
    .sort((a, b) => displayOrder.indexOf(a.id) - displayOrder.indexOf(b.id));
}

function findPlan(planId, guildId = null) {
  return getPlans(guildId).find((plan) => plan.id === planId) || null;
}

function channelSafe(value) {
  return String(value || 'usuario')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'usuario';
}

function buildSeparator(spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(spacing);
}

function buildPayload(container, flags = COMPONENTS_V2, files = []) {
  return {
    flags,
    components: [container],
    ...(files.length ? { files } : {})
  };
}

function buildNoticePayload(message, color = SALES_PANEL_COLOR, ephemeral = true) {
  return buildPayload(
    new ContainerBuilder()
      .setAccentColor(color)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(message)),
    ephemeral ? EPHEMERAL_COMPONENTS_V2 : COMPONENTS_V2
  );
}

function buildLegacyPlanSection(plan) {
  return new TextDisplayBuilder().setContent(
    `${plan.emoji} **${plan.name}**\n` +
      `💰 ${plan.priceLabel}\n` +
      plan.benefits.map((benefit) => `✅ ${benefit}`).join('\n')
    );
}

function normalizePanelPlanIds(planIds = null) {
  if (!planIds) return null;
  if (Array.isArray(planIds)) return planIds.filter(Boolean);
  return String(planIds)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlanSection(plan) {
  const names = {
    basico: '🌱 Plano Basico',
    profissional: '🚀 Plano Profissional',
    vitalicio: '👑 Plano Vitalicio',
    fivem_fac: '🏙️ Plano FiveM FAC',
    monthly: '📅 Plano Mensal'
  };
  const idealFor = {
    basico: 'Servidores pequenos que precisam comecar com automacoes essenciais.',
    profissional: 'Comunidades que precisam de tickets, paineis e operacao completa.',
    vitalicio: 'Quem quer fechar o projeto de forma definitiva. O bot e vitalicio, e a hospedagem e paga mensalmente se usar nossa hospedagem.',
    fivem_fac: 'Faccoes FiveM que precisam controlar recrutamento, registro e hierarquia.',
    monthly: 'Quem quer pagar por mes com hospedagem inclusa no valor do plano.'
  };
  const cleanBenefits = {
    basico: ['Comandos essenciais', 'Painel simples com botoes', 'Boas-vindas, avisos e logs basicos', 'Configuracao inicial inclusa'],
    profissional: ['Tudo do Basico', 'Sistema de tickets e suporte', 'Automacoes avancadas e relatorios', 'Painel completo para operacao'],
    vitalicio: ['Tudo do Profissional', 'Acesso vitalicio ao bot contratado', 'Sem renovacao do plano do bot', 'Hospedagem cobrada por mes quando contratada'],
    fivem_fac: ['Bot personalizado para faccao FiveM', 'Painel de recrutamento e registro', 'Tickets para membros e suporte', 'Hierarquia de cargos e logs internos'],
    monthly: ['Pagamento mensal', 'Hospedagem inclusa', 'Aceita cupom ativo', 'Contrato e Pix no ticket', 'Codigo de liberacao apos criar senha']
  };
  const benefits = (cleanBenefits[plan.id] || plan.benefits || []).map((benefit) => `• ${benefit}`).join('\n');

  return new TextDisplayBuilder().setContent(
    `### ${names[plan.id] || plan.name}\n` +
      `**Valor:** ${plan.priceLabel}\n` +
      `**Indicado para:** ${idealFor[plan.id] || 'Projetos personalizados.'}\n\n` +
      benefits
    );
}

function buildSalesPanelContainer(guildId = null, options = {}) {
  const planIds = normalizePanelPlanIds(options.planIds);
  const plans = getPlans(guildId, planIds);
  const monthlyOnly = planIds?.length === 1 && planIds[0] === 'monthly';
  const panelTitle = options.title || (monthlyOnly ? '📅 **Plano Mensal**' : '🛒 **Loja de Planos**');
  const panelDescription = options.description || (monthlyOnly
    ? 'Contrate por mes com hospedagem inclusa, contrato, Pix e liberacao controlada.'
    : 'Escolha o melhor plano para você e garanta seu acesso agora mesmo.');
  const howItWorksText = monthlyOnly
    ? 'Escolha o plano mensal, assine o contrato, confirme o Pix e crie a chave/senha para receber o codigo de liberacao.'
    : 'Escolha um plano, assine o contrato, selecione 50% ou 100%, confirme o pagamento e entre na fila de producao.';
  const extraText = monthlyOnly
    ? '**Hospedagem inclusa no mensal.**\nO pagamento do plano mensal ja cobre a hospedagem do bot.'
    : '**No vitalicio, a hospedagem e separada.**\nO bot fica vitalicio, mas a hospedagem continua mensal quando contratada.';
  const container = new ContainerBuilder()
    .setAccentColor(SALES_PANEL_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(SALES_BANNER_URL)
          .setDescription('Banner Orvitek Bots')
      )
    )
    .addSeparatorComponents(buildSeparator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${panelTitle}\n${panelDescription}`
      )
    )
    .addSeparatorComponents(buildSeparator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '## Como funciona\n' +
          howItWorksText
      )
    )
    .addSeparatorComponents(buildSeparator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        extraText
      )
    )
    .addSeparatorComponents(buildSeparator());

  for (const plan of plans) {
    container
      .addTextDisplayComponents(buildPlanSection(plan))
      .addSeparatorComponents(buildSeparator());
  }

  if (!plans.length) {
    return container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Nenhum plano configurado para este painel.')
    );
  }

  return container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      ...plans.map((plan) =>
        new ButtonBuilder()
          .setCustomId(plan.buttonId)
          .setLabel(({
            basico: 'Basico',
            profissional: 'Profissional',
            vitalicio: 'Vitalicio',
            fivem_fac: 'FiveM FAC',
            monthly: 'Mensal'
          })[plan.id] || plan.name.replace('Plano ', ''))
          .setStyle(plan.id === 'profissional' || plan.id === 'monthly' ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    )
  );
}

function buildPlanSelectionPanelPayload(guildId = null, options = {}) {
  return buildPayload(buildSalesPanelContainer(guildId, options), COMPONENTS_V2, [
    { attachment: SALES_BANNER_PATH, name: SALES_BANNER_FILE_NAME }
  ]);
}

function buildMonthlyPlanPanelPayload(guildId = null) {
  return buildPlanSelectionPanelPayload(guildId, {
    planIds: ['monthly'],
    title: '📅 **Plano Mensal**',
    description: 'Canal exclusivo do plano mensal: pagamento por mes com hospedagem inclusa.'
  });
}

function buildLifetimePlanPanelPayload(guildId = null) {
  return buildPlanSelectionPanelPayload(guildId, {
    planIds: ['vitalicio'],
    title: '👑 **Plano Vitalicio**',
    description: 'Canal do plano vitalicio: o bot nao renova, mas a hospedagem e paga por mes quando contratada.'
  });
}

function buildPlanPanelPayloadForChannel(guildId = null, channelId = null, setup = {}) {
  if (channelId && (
    channelId === process.env.LIFETIME_PLAN_CHANNEL_ID ||
    channelId === process.env.BUY_NOW_CHANNEL_ID ||
    channelId === setup?.channels?.buyNow
  )) {
    return buildLifetimePlanPanelPayload(guildId);
  }

  return buildMonthlyPlanPanelPayload(guildId);
}

async function sendPlanSelectionPanel(client, channelId = process.env.CANAL_ID || process.env.PLAN_PANEL_CHANNEL_ID, options = {}) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error(`Canal de planos inválido ou não encontrado: ${channelId || 'sem id'}`);
  }

  return channel.send(buildPlanSelectionPanelPayload(channel.guild?.id, options));
}

function buildStep1Container(notice = null, guildId = null) {
  const plans = getPlans(guildId);
  const text = [
    '📦 **Passo 1 de 3 — Escolha seu Plano**',
    'Selecione o plano que deseja adquirir:'
  ];

  if (notice) {
    text.push('', notice);
  }

  return new ContainerBuilder()
    .setAccentColor(SALES_PANEL_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.join('\n')))
    .addSeparatorComponents(buildSeparator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(PLAN_SELECT_CUSTOM_ID)
          .setPlaceholder('Selecione um plano...')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            plans.map((plan) => ({
              label: `${plan.emoji} ${plan.name}`,
              value: plan.id,
              description: plan.priceLabel
            }))
          )
      )
    );
}

function ensureSelection(userId) {
  const selection = selecaoMap.get(userId) || {};
  selecaoMap.set(userId, selection);
  return selection;
}

function calculateSelection(userId, guildId = null) {
  const selection = selecaoMap.get(userId) || {};
  const plan = findPlan(selection.plano, guildId);
  if (!plan) return null;

  const couponCode = selection.cupom?.codigo || null;
  const coupon = couponCode ? cupons[couponCode] : null;
  const discount = coupon?.tipo === 'porcentagem'
    ? plan.price * (coupon.desconto / 100)
    : Number(coupon?.desconto || 0);
  const finalValue = Math.max(0, plan.price - discount);

  const calculated = {
    ...selection,
    plan,
    desconto: discount,
    valorFinal: Number(finalValue.toFixed(2))
  };

  selecaoMap.set(userId, calculated);
  return calculated;
}

function couponText(selection) {
  if (!selection?.cupom) return 'Sem cupom';
  if (selection.cupom.tipo === 'porcentagem') {
    return `${selection.cupom.codigo} (-${selection.cupom.desconto}%)`;
  }

  return `${selection.cupom.codigo} (-${formatMoney(selection.cupom.desconto)})`;
}

function buildStep2Container(userId, notice = null, guildId = null) {
  const selection = calculateSelection(userId, guildId);
  const planLine = selection?.plan
    ? `Plano selecionado: **${selection.plan.name} — ${selection.plan.priceLabel}**`
    : 'Plano selecionado: **Nenhum plano encontrado**';
  const text = [
    '🏷️ **Passo 2 de 3 — Cupom de Desconto**',
    planLine,
    'Você possui algum cupom de desconto?'
  ];

  if (notice) {
    text.push('', notice);
  }

  return new ContainerBuilder()
    .setAccentColor(SALES_PANEL_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.join('\n')))
    .addSeparatorComponents(buildSeparator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tem_cupom')
          .setLabel('✅ Sim, tenho cupom')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('sem_cupom')
          .setLabel('❌ Não tenho cupom')
          .setStyle(ButtonStyle.Secondary)
      )
    );
}

function buildStep3Container(userId, guildId = null) {
  const selection = calculateSelection(userId, guildId);
  if (!selection?.plan) {
    return buildStep1Container('⚠️ Selecione um plano antes de continuar.', guildId);
  }

  return new ContainerBuilder()
    .setAccentColor(PAYMENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '💳 **Passo 3 de 3 — Pagamento**\n' +
          `📦 Plano: **${selection.plan.name}**\n` +
          `🏷️ Cupom aplicado: **${couponText(selection)}**\n` +
          `💰 **Valor final: ${formatMoney(selection.valorFinal)}**\n\n` +
          '📎 Se já realizou o pagamento, envie o comprovante abaixo.\n' +
          'Ou clique em **Efetuar Pagamento** para ver os dados do PIX.'
      )
    )
    .addSeparatorComponents(buildSeparator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ver_pix')
          .setLabel('💳 Efetuar Pagamento (ver PIX)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('enviar_comprovante')
          .setLabel('📎 Já paguei — Enviar Comprovante')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('voltar_etapa1')
          .setLabel('↩️ Voltar')
          .setStyle(ButtonStyle.Secondary)
      )
    );
}

function pixConfig() {
  return {
    key: process.env.PIX_KEY || process.env.PIX_CHAVE || process.env.CHAVE_PIX || 'seu-email@gmail.com',
    beneficiary: process.env.PIX_NOME || process.env.PIX_RECEBEDOR || 'Nome da Loja'
  };
}

function buildPixContainer(userId, guildId = null) {
  const selection = calculateSelection(userId, guildId);
  if (!selection?.plan) {
    return buildStep1Container('⚠️ Selecione um plano antes de ver o PIX.', guildId);
  }

  const pix = pixConfig();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pix.key)}`;

  return new ContainerBuilder()
    .setAccentColor(PIX_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '💳 **Dados para Pagamento via PIX**\n\n' +
          `🔑 **Chave PIX:** ${pix.key}\n` +
          `👤 **Beneficiário:** ${pix.beneficiary}\n` +
          `💰 **Valor: ${formatMoney(selection.valorFinal)}**\n\n` +
          '📱 QR Code gerado automaticamente abaixo:'
      )
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(qrUrl)
          .setDescription('QR Code PIX')
      )
    )
    .addSeparatorComponents(buildSeparator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('enviar_comprovante')
          .setLabel('📎 Enviar Comprovante')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('voltar_etapa3')
          .setLabel('↩️ Voltar')
          .setStyle(ButtonStyle.Secondary)
      )
    );
}

function buildCouponModal() {
  return new ModalBuilder()
    .setCustomId('modal_cupom')
    .setTitle('🏷️ Inserir Cupom de Desconto')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('codigo_cupom')
          .setLabel('Digite seu cupom:')
          .setPlaceholder('Ex: PROMO20')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildReceiptModal() {
  return new ModalBuilder()
    .setCustomId('modal_comprovante')
    .setTitle('📎 Enviar Comprovante de Pagamento')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('url_comprovante')
          .setLabel('Cole o link da imagem do comprovante:')
          .setPlaceholder('https://imgur.com/sua-imagem.png')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('observacao')
          .setLabel('Observação (opcional):')
          .setPlaceholder('Alguma informação adicional?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );
}

function buildRejectModal() {
  return new ModalBuilder()
    .setCustomId('modal_recusa')
    .setTitle('❌ Motivo da Recusa')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('motivo_recusa')
          .setLabel('Informe o motivo da recusa:')
          .setPlaceholder('Ex: comprovante ilegível ou valor incorreto.')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
}

function roleCandidates(setup, type) {
  if (type === 'support') {
    return [
      process.env.CARGO_SUPORTE,
      process.env.SUPPORT_ROLE_ID,
      process.env.TICKET_ALERT_ROLE_ID || DEFAULT_SUPPORT_ROLE_ID,
      setup?.roles?.support
    ].filter(Boolean);
  }

  return [
    process.env.CARGO_CLIENTE,
    process.env.CLIENT_ROLE_ID,
    setup?.roles?.active
  ].filter(Boolean);
}

async function resolveRoleId(guild, ids) {
  for (const id of ids) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (role) return role.id;
  }

  return null;
}

function resolveTicketCategoryId(setup) {
  return process.env.CANAL_TICKETS || process.env.TICKET_CATEGORY_ID || setup?.categories?.supportCategory || null;
}

function isSupportMember(member, setup) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  return roleCandidates(setup, 'support').some((roleId) => member.roles?.cache?.has(roleId));
}

async function replyError(interaction, message) {
  try {
    const payload = buildNoticePayload(message, ERROR_COLOR, true);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
      return;
    }

    await interaction.reply(payload).catch(() => null);
  } catch (error) {
    console.error(`[${interaction.customId || interaction.id}] Falha ao responder erro:`, error);
  }
}

async function updateError(interaction, message) {
  await interaction.update(buildPayload(
    new ContainerBuilder()
      .setAccentColor(ERROR_COLOR)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(message))
      .addSeparatorComponents(buildSeparator())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('voltar_etapa1')
            .setLabel('↩️ Voltar')
            .setStyle(ButtonStyle.Secondary)
        )
      )
  ));
}

async function existingTicketChannel(guild, userId) {
  const channelId = ticketMap.get(userId);
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel) return channel;

  ticketMap.delete(userId);
  return null;
}

function forgetTicketByChannel(channelId) {
  for (const [userId, mappedChannelId] of ticketMap.entries()) {
    if (mappedChannelId === channelId) {
      ticketMap.delete(userId);
      return userId;
    }
  }

  return null;
}

function findTicketOwnerByChannel(channelId) {
  for (const [userId, mappedChannelId] of ticketMap.entries()) {
    if (mappedChannelId === channelId) {
      return userId;
    }
  }

  return null;
}

function scheduleTicketDeletion(channel, delayMs, reason) {
  const timeout = setTimeout(() => {
    channel.delete(reason)
      .then(() => forgetTicketByChannel(channel.id))
      .catch((error) => console.warn(`Não foi possível deletar ticket ${channel.id}: ${error.message}`));
  }, delayMs);
  timeout.unref?.();
}

function buildMediaGallery(url, description) {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(url)
      .setDescription(description)
  );
}

function buildReceiptTicketPayload({ user, selection, comprovanteUrl, observation }) {
  const timestamp = Math.floor(Date.now() / 1000);

  return buildPayload(
    new ContainerBuilder()
      .setAccentColor(PAYMENT_COLOR)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '📋 **Novo Comprovante de Pagamento**\n' +
            `👤 Usuário: <@${user.id}>\n` +
            `📦 Plano: ${selection.plan.name}\n` +
            `💰 Valor pago: ${formatMoney(selection.valorFinal)}\n` +
            `🏷️ Cupom: ${selection.cupom?.codigo || 'Nenhum'}\n` +
            `📝 Observação: ${observation || 'Nenhuma'}\n` +
            `📅 Data: <t:${timestamp}:F>`
        )
      )
      .addMediaGalleryComponents(buildMediaGallery(comprovanteUrl, 'Comprovante de pagamento'))
      .addSeparatorComponents(buildSeparator())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`aprovar_${user.id}_${selection.plan.id}`)
            .setLabel('✅ Aprovar')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`recusar_${user.id}_${selection.plan.id}`)
            .setLabel('❌ Recusar')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('fechar_ticket')
            .setLabel('🔒 Fechar')
            .setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

function buildReceiptSuccessContainer(channel) {
  return new ContainerBuilder()
    .setAccentColor(PAYMENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '✅ **Comprovante enviado com sucesso!**\n' +
          'Nossa equipe irá verificar seu pagamento.\n' +
          'Você será notificado assim que for aprovado.\n' +
          `📂 Ticket: ${channel}`
      )
    );
}

async function createReceiptTicket(interaction, comprovanteUrl, observation) {
  const selection = calculateSelection(interaction.user.id, interaction.guild.id);
  if (!selection?.plan) {
    await interaction.editReply(buildPayload(buildStep1Container('⚠️ Sua sessão expirou. Selecione o plano novamente.', interaction.guild.id)));
    return true;
  }

  const existing = await existingTicketChannel(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.editReply(buildNoticePayload(`⚠️ Você já tem um ticket aberto: ${existing}.`, ERROR_COLOR, false));
    return true;
  }

  const setup = setupForGuild(interaction.guild.id);
  const categoryId = resolveTicketCategoryId(setup);
  if (!categoryId) {
    await interaction.editReply(buildNoticePayload('⚠️ Categoria de tickets não configurada. Configure CANAL_TICKETS no .env.', ERROR_COLOR, false));
    return true;
  }

  const supportRoleId = await resolveRoleId(interaction.guild, roleCandidates(setup, 'support'));
  const permissionOverwrites = [
    {
      id: interaction.guild.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  if (supportRoleId) {
    permissionOverwrites.push({
      id: supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${channelSafe(interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites,
    reason: `Ticket de venda aberto por ${interaction.user.tag}`
  });

  ticketMap.set(interaction.user.id, channel.id);

  await channel.send({
    ...buildReceiptTicketPayload({
      user: interaction.user,
      selection,
      comprovanteUrl,
      observation
    }),
    allowedMentions: {
      users: [interaction.user.id],
      roles: supportRoleId ? [supportRoleId] : []
    }
  });

  await interaction.editReply(buildPayload(buildReceiptSuccessContainer(channel)));
  return true;
}

async function sendUserDm(user, message, color = PAYMENT_COLOR) {
  await user.send(buildNoticePayload(message, color, false)).catch(() => null);
}

async function sendTicketNotice(channel, message, color = PAYMENT_COLOR) {
  await channel.send(buildNoticePayload(message, color, false));
}

async function handleOpenStore(interaction) {
  try {
    selecaoMap.set(interaction.user.id, {});
    await interaction.reply(buildPayload(buildStep1Container(null, interaction.guild.id), EPHEMERAL_COMPONENTS_V2));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao abrir loja:`, error);
    await replyError(interaction, 'Não consegui abrir o painel de vendas.');
    return true;
  }
}

async function handlePlanSelection(interaction) {
  try {
    const planId = interaction.values?.[0];
    if (!findPlan(planId, interaction.guild.id)) {
      await updateError(interaction, '⚠️ Plano selecionado não foi encontrado.');
      return true;
    }

    selecaoMap.set(interaction.user.id, { plano: planId });
    await interaction.update(buildPayload(buildStep2Container(interaction.user.id, null, interaction.guild.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao escolher plano:`, error);
    await replyError(interaction, 'Não consegui selecionar esse plano.');
    return true;
  }
}

async function handleCouponChoice(interaction, hasCoupon) {
  try {
    const selection = calculateSelection(interaction.user.id, interaction.guild.id);
    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Selecione um plano antes de continuar.', interaction.guild.id)));
      return true;
    }

    if (hasCoupon) {
      await interaction.showModal(buildCouponModal());
      return true;
    }

    selection.cupom = null;
    selecaoMap.set(interaction.user.id, selection);
    await interaction.update(buildPayload(buildStep3Container(interaction.user.id, interaction.guild.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha no cupom:`, error);
    await replyError(interaction, 'Não consegui continuar a etapa de cupom.');
    return true;
  }
}

async function handleCouponModal(interaction) {
  try {
    const rawCode = interaction.fields.getTextInputValue('codigo_cupom').trim().toUpperCase();
    const coupon = cupons[rawCode];
    const selection = calculateSelection(interaction.user.id, interaction.guild.id);

    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Sua sessão expirou. Selecione o plano novamente.', interaction.guild.id)));
      return true;
    }

    if (!coupon) {
      await interaction.update(buildPayload(
        buildStep2Container(interaction.user.id, `⚠️ Cupom **${rawCode || 'informado'}** inválido. Tente outro cupom ou continue sem cupom.`, interaction.guild.id)
      ));
      return true;
    }

    selection.cupom = {
      codigo: rawCode,
      ...coupon
    };
    selecaoMap.set(interaction.user.id, selection);
    await interaction.update(buildPayload(buildStep3Container(interaction.user.id, interaction.guild.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao validar cupom:`, error);
    await replyError(interaction, 'Não consegui validar esse cupom.');
    return true;
  }
}

async function handlePixView(interaction) {
  try {
    await interaction.update(buildPayload(buildPixContainer(interaction.user.id, interaction.guild.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao mostrar PIX:`, error);
    await replyError(interaction, 'Não consegui mostrar os dados do PIX.');
    return true;
  }
}

async function handleReceiptButton(interaction) {
  try {
    const selection = calculateSelection(interaction.user.id, interaction.guild.id);
    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Selecione um plano antes de enviar comprovante.', interaction.guild.id)));
      return true;
    }

    await interaction.showModal(buildReceiptModal());
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao abrir modal de comprovante:`, error);
    await replyError(interaction, 'Não consegui abrir o formulário de comprovante.');
    return true;
  }
}

async function handleReceiptModalSubmit(interaction) {
  try {
    if (interaction.customId === 'modal_cupom') {
      return handleCouponModal(interaction);
    }

    if (interaction.customId === 'modal_recusa') {
      return handleRejectModalSubmit(interaction);
    }

    if (interaction.customId !== 'modal_comprovante') {
      return false;
    }

    await interaction.deferUpdate();
    const comprovanteUrl = interaction.fields.getTextInputValue('url_comprovante').trim();
    const observation = interaction.fields.getTextInputValue('observacao')?.trim();

    if (!/^https?:\/\/\S+/i.test(comprovanteUrl)) {
      await interaction.editReply(buildPayload(
        new ContainerBuilder()
          .setAccentColor(ERROR_COLOR)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              '⚠️ **URL inválida**\nEnvie um link iniciado por `http://` ou `https://`.'
            )
          )
          .addSeparatorComponents(buildSeparator())
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('enviar_comprovante')
                .setLabel('📎 Tentar novamente')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId('voltar_etapa3')
                .setLabel('↩️ Voltar')
                .setStyle(ButtonStyle.Secondary)
            )
          )
      ));
      return true;
    }

    return createReceiptTicket(interaction, comprovanteUrl, observation);
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao processar modal:`, error);
    await replyError(interaction, 'Não consegui processar este formulário.');
    return true;
  }
}

async function handleApprovePurchase(interaction) {
  try {
    const setup = setupForGuild(interaction.guild.id);
    if (!isSupportMember(interaction.member, setup)) {
      await interaction.reply(buildNoticePayload('Apenas a equipe de suporte pode aprovar compras.', ERROR_COLOR, true));
      return true;
    }

    await interaction.deferUpdate();

    const [, userId, ...planParts] = interaction.customId.split('_');
    const planId = planParts.join('_');
    const plan = findPlan(planId, interaction.guild.id);
    const clientRoleId = await resolveRoleId(interaction.guild, roleCandidates(setup, 'client'));
    if (!clientRoleId) {
      await sendTicketNotice(interaction.channel, '⚠️ Cargo de cliente não configurado. Configure CARGO_CLIENTE no .env.', ERROR_COLOR);
      return true;
    }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const role = await interaction.guild.roles.fetch(clientRoleId).catch(() => null);
    if (!member || !role) {
      await sendTicketNotice(interaction.channel, '⚠️ Usuário ou cargo de cliente não encontrado.', ERROR_COLOR);
      return true;
    }

    if (!role.editable) {
      await sendTicketNotice(interaction.channel, '⚠️ Não consigo adicionar esse cargo por hierarquia/permissão do bot.', ERROR_COLOR);
      return true;
    }

    await member.roles.add(role, `Compra aprovada por ${interaction.user.tag}`);
    selecaoMap.delete(userId);
    ticketMap.delete(userId);

    await sendTicketNotice(
      interaction.channel,
      `✅ **Compra aprovada!**\nUsuário: <@${userId}>\nPlano ativado: **${plan?.name || planId}**\nCargo aplicado: <@&${role.id}>`
    );
    await sendUserDm(member.user, `✅ Seu plano foi ativado!\nPlano: **${plan?.name || planId}**`);
    scheduleTicketDeletion(interaction.channel, 5000, `Compra aprovada por ${interaction.user.tag}`);
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao aprovar compra:`, error);
    await replyError(interaction, 'Não consegui aprovar esta compra.');
    return true;
  }
}

async function handleRejectPurchase(interaction) {
  try {
    const setup = setupForGuild(interaction.guild.id);
    if (!isSupportMember(interaction.member, setup)) {
      await interaction.reply(buildNoticePayload('Apenas a equipe de suporte pode recusar compras.', ERROR_COLOR, true));
      return true;
    }

    const [, userId, ...planParts] = interaction.customId.split('_');
    const planId = planParts.join('_');
    recusaMap.set(interaction.user.id, {
      userId,
      planId,
      channelId: interaction.channelId
    });
    await interaction.showModal(buildRejectModal());
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao abrir modal de recusa:`, error);
    await replyError(interaction, 'Não consegui abrir o formulário de recusa.');
    return true;
  }
}

async function handleRejectModalSubmit(interaction) {
  try {
    await interaction.deferUpdate();

    const context = recusaMap.get(interaction.user.id);
    recusaMap.delete(interaction.user.id);
    if (!context) {
      await interaction.editReply(buildNoticePayload('⚠️ Não encontrei o contexto da recusa.', ERROR_COLOR, false));
      return true;
    }

    const reason = interaction.fields.getTextInputValue('motivo_recusa').trim();
    const plan = findPlan(context.planId, interaction.guild.id);
    const channel = interaction.channel || await interaction.guild.channels.fetch(context.channelId).catch(() => null);
    const user = await interaction.client.users.fetch(context.userId).catch(() => null);

    if (channel?.isTextBased()) {
      await sendTicketNotice(
        channel,
        `❌ **Compra recusada**\nUsuário: <@${context.userId}>\nPlano: **${plan?.name || context.planId}**\nMotivo: ${reason}`,
        ERROR_COLOR
      );
      scheduleTicketDeletion(channel, 10000, `Compra recusada por ${interaction.user.tag}`);
    }

    if (user) {
      await sendUserDm(
        user,
        `❌ Seu pagamento foi recusado.\nPlano: **${plan?.name || context.planId}**\nMotivo: ${reason}`,
        ERROR_COLOR
      );
    }

    selecaoMap.delete(context.userId);
    ticketMap.delete(context.userId);
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao recusar compra:`, error);
    await replyError(interaction, 'Não consegui concluir a recusa.');
    return true;
  }
}

async function handleCloseTicket(interaction) {
  try {
    const setup = setupForGuild(interaction.guild.id);
    if (!isSupportMember(interaction.member, setup)) {
      await interaction.reply(buildNoticePayload('Apenas a equipe de suporte pode fechar tickets.', ERROR_COLOR, true));
      return true;
    }

    await interaction.deferUpdate();

    const userId = findTicketOwnerByChannel(interaction.channelId);
    if (userId) {
      await interaction.channel.permissionOverwrites.edit(userId, {
        SendMessages: false
      }).catch((error) => {
        console.warn(`Não foi possível remover envio do usuário ${userId}: ${error.message}`);
      });
      ticketMap.delete(userId);
    }

    await sendTicketNotice(interaction.channel, '🔒 **Ticket encerrado.**\nEste canal será deletado em 10 segundos.', ERROR_COLOR);
    scheduleTicketDeletion(interaction.channel, 10000, `Ticket fechado por ${interaction.user.tag}`);
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao fechar ticket:`, error);
    await replyError(interaction, 'Não consegui fechar este ticket.');
    return true;
  }
}

async function handlePlanButton(interaction) {
  if (interaction.customId === 'abrir_loja') {
    return handleOpenStore(interaction);
  }

  if (interaction.customId === 'tem_cupom') {
    return handleCouponChoice(interaction, true);
  }

  if (interaction.customId === 'sem_cupom') {
    return handleCouponChoice(interaction, false);
  }

  if (interaction.customId === 'ver_pix') {
    return handlePixView(interaction);
  }

  if (interaction.customId === 'enviar_comprovante') {
    return handleReceiptButton(interaction);
  }

  if (interaction.customId === 'voltar_etapa1') {
    try {
      await interaction.update(buildPayload(buildStep1Container(null, interaction.guild.id)));
      return true;
    } catch (error) {
      console.error(`[${interaction.customId}] Falha ao voltar etapa 1:`, error);
      await replyError(interaction, 'Não consegui voltar para a etapa 1.');
      return true;
    }
  }

  if (interaction.customId === 'voltar_etapa3') {
    try {
      await interaction.update(buildPayload(buildStep3Container(interaction.user.id, interaction.guild.id)));
      return true;
    } catch (error) {
      console.error(`[${interaction.customId}] Falha ao voltar etapa 3:`, error);
      await replyError(interaction, 'Não consegui voltar para a etapa 3.');
      return true;
    }
  }

  if (interaction.customId.startsWith('aprovar_')) {
    return handleApprovePurchase(interaction);
  }

  if (interaction.customId.startsWith('recusar_')) {
    return handleRejectPurchase(interaction);
  }

  if (interaction.customId === 'fechar_ticket') {
    return handleCloseTicket(interaction);
  }

  return false;
}

module.exports = {
  PLAN_SELECT_CUSTOM_ID,
  buildLifetimePlanPanelPayload,
  buildMonthlyPlanPanelPayload,
  buildNoticePayload,
  buildPlanPanelPayloadForChannel,
  buildPlanSelectionPanelPayload,
  handlePlanButton,
  handlePlanSelection,
  handleReceiptModalSubmit,
  plans: getPlans(),
  sendPlanSelectionPanel,
  selecaoMap,
  ticketMap
};
