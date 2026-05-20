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
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder
} = require('discord.js');
const { getGuildSetup } = require('./store');

const PLAN_SELECT_CUSTOM_ID = 'escolher_plano';
const SALES_PANEL_COLOR = 0x5865f2;
const PAYMENT_COLOR = 0x57f287;
const PIX_COLOR = 0xfee75c;
const ERROR_COLOR = 0xff4757;
const DEFAULT_SUPPORT_ROLE_ID = '1505184193766752386';
const COMPONENTS_V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL_COMPONENTS_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

const selecaoMap = new Map();
const ticketMap = new Map();
const recusaMap = new Map();

const cupons = {
  PROMO20: { desconto: 20, tipo: 'porcentagem' },
  VIP10: { desconto: 10, tipo: 'fixo' }
};

const plans = [
  {
    id: 'basic',
    emoji: '🥉',
    name: 'Plano Basic',
    price: 19.9,
    priceLabel: 'R$ 19,90/mês',
    iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f949.png',
    benefits: [
      'Acesso básico ao sistema',
      'Suporte por ticket',
      'Atualizações essenciais'
    ]
  },
  {
    id: 'pro',
    emoji: '🥈',
    name: 'Plano Pro',
    price: 34.9,
    priceLabel: 'R$ 34,90/mês',
    iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f948.png',
    benefits: [
      'Tudo do Basic',
      'Suporte prioritário',
      'Recursos avançados'
    ]
  },
  {
    id: 'vip',
    emoji: '🥇',
    name: 'Plano VIP',
    price: 49.9,
    priceLabel: 'R$ 49,90/mês',
    iconUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f947.png',
    benefits: [
      'Tudo do Pro',
      'Atendimento exclusivo',
      'Benefícios VIP'
    ]
  }
];

function findPlan(planId) {
  return plans.find((plan) => plan.id === planId) || null;
}

function setupForGuild(guildId) {
  return getGuildSetup(guildId) || {};
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
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

function buildPayload(container, flags = COMPONENTS_V2) {
  return {
    flags,
    components: [container]
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

function buildPlanSection(plan) {
  return new SectionBuilder()
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(plan.iconUrl)
        .setDescription(`${plan.name} icon`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${plan.emoji} **${plan.name}**\n` +
          `💰 ${plan.priceLabel}\n` +
          plan.benefits.map((benefit) => `✅ ${benefit}`).join('\n')
      )
    );
}

function buildSalesPanelContainer() {
  const container = new ContainerBuilder()
    .setAccentColor(SALES_PANEL_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '🛒 **Loja de Planos**\n' +
          'Escolha o melhor plano para você e garanta seu acesso agora mesmo.'
      )
    )
    .addSeparatorComponents(buildSeparator());

  for (const plan of plans) {
    container.addSectionComponents(buildPlanSection(plan));
  }

  return container
    .addSeparatorComponents(buildSeparator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_loja')
          .setLabel('🛒 Comprar Agora')
          .setStyle(ButtonStyle.Primary)
      )
    );
}

function buildPlanSelectionPanelPayload() {
  return buildPayload(buildSalesPanelContainer());
}

async function sendPlanSelectionPanel(client, channelId = process.env.CANAL_ID || process.env.PLAN_PANEL_CHANNEL_ID) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error(`Canal de planos inválido ou não encontrado: ${channelId || 'sem id'}`);
  }

  return channel.send(buildPlanSelectionPanelPayload());
}

function buildStep1Container(notice = null) {
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

function calculateSelection(userId) {
  const selection = selecaoMap.get(userId) || {};
  const plan = findPlan(selection.plano);
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

function buildStep2Container(userId, notice = null) {
  const selection = calculateSelection(userId);
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

function buildStep3Container(userId) {
  const selection = calculateSelection(userId);
  if (!selection?.plan) {
    return buildStep1Container('⚠️ Selecione um plano antes de continuar.');
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

function buildPixContainer(userId) {
  const selection = calculateSelection(userId);
  if (!selection?.plan) {
    return buildStep1Container('⚠️ Selecione um plano antes de ver o PIX.');
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
  const selection = calculateSelection(interaction.user.id);
  if (!selection?.plan) {
    await interaction.editReply(buildPayload(buildStep1Container('⚠️ Sua sessão expirou. Selecione o plano novamente.')));
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
    await interaction.reply(buildPayload(buildStep1Container(), EPHEMERAL_COMPONENTS_V2));
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
    if (!findPlan(planId)) {
      await updateError(interaction, '⚠️ Plano selecionado não foi encontrado.');
      return true;
    }

    selecaoMap.set(interaction.user.id, { plano: planId });
    await interaction.update(buildPayload(buildStep2Container(interaction.user.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao escolher plano:`, error);
    await replyError(interaction, 'Não consegui selecionar esse plano.');
    return true;
  }
}

async function handleCouponChoice(interaction, hasCoupon) {
  try {
    const selection = calculateSelection(interaction.user.id);
    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Selecione um plano antes de continuar.')));
      return true;
    }

    if (hasCoupon) {
      await interaction.showModal(buildCouponModal());
      return true;
    }

    selection.cupom = null;
    selecaoMap.set(interaction.user.id, selection);
    await interaction.update(buildPayload(buildStep3Container(interaction.user.id)));
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
    const selection = calculateSelection(interaction.user.id);

    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Sua sessão expirou. Selecione o plano novamente.')));
      return true;
    }

    if (!coupon) {
      await interaction.update(buildPayload(
        buildStep2Container(interaction.user.id, `⚠️ Cupom **${rawCode || 'informado'}** inválido. Tente outro cupom ou continue sem cupom.`)
      ));
      return true;
    }

    selection.cupom = {
      codigo: rawCode,
      ...coupon
    };
    selecaoMap.set(interaction.user.id, selection);
    await interaction.update(buildPayload(buildStep3Container(interaction.user.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao validar cupom:`, error);
    await replyError(interaction, 'Não consegui validar esse cupom.');
    return true;
  }
}

async function handlePixView(interaction) {
  try {
    await interaction.update(buildPayload(buildPixContainer(interaction.user.id)));
    return true;
  } catch (error) {
    console.error(`[${interaction.customId}] Falha ao mostrar PIX:`, error);
    await replyError(interaction, 'Não consegui mostrar os dados do PIX.');
    return true;
  }
}

async function handleReceiptButton(interaction) {
  try {
    const selection = calculateSelection(interaction.user.id);
    if (!selection?.plan) {
      await interaction.update(buildPayload(buildStep1Container('⚠️ Selecione um plano antes de enviar comprovante.')));
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

    const [, userId, planId] = interaction.customId.split('_');
    const plan = findPlan(planId);
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

    const [, userId, planId] = interaction.customId.split('_');
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
    const plan = findPlan(context.planId);
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
      await interaction.update(buildPayload(buildStep1Container()));
      return true;
    } catch (error) {
      console.error(`[${interaction.customId}] Falha ao voltar etapa 1:`, error);
      await replyError(interaction, 'Não consegui voltar para a etapa 1.');
      return true;
    }
  }

  if (interaction.customId === 'voltar_etapa3') {
    try {
      await interaction.update(buildPayload(buildStep3Container(interaction.user.id)));
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
  buildNoticePayload,
  buildPlanSelectionPanelPayload,
  handlePlanButton,
  handlePlanSelection,
  handleReceiptModalSubmit,
  plans,
  sendPlanSelectionPanel,
  selecaoMap,
  ticketMap
};
