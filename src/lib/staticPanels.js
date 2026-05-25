const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} = require('discord.js');
const path = require('node:path');
const { colors } = require('../config/setup');
const { getBoostDiscountPercent } = require('./plans');

const COMPONENTS_V2 = MessageFlags.IsComponentsV2;
const PANEL_BANNER_FILE_NAME = 'orvitek-bots-banner.png';
const PANEL_BANNER_PATH = path.join(__dirname, '..', '..', 'assets', PANEL_BANNER_FILE_NAME);
const PANEL_BANNER_URL = `attachment://${PANEL_BANNER_FILE_NAME}`;

function withPanelBanner(payload) {
  return {
    ...payload,
    files: [...(payload.files || []), { attachment: PANEL_BANNER_PATH, name: PANEL_BANNER_FILE_NAME }]
  };
}

function buildSeparator() {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function buildBannerGallery(description) {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(PANEL_BANNER_URL)
      .setDescription(description || 'Banner Orvitek Bots')
  );
}

function buildPanelPayload(container) {
  return withPanelBanner({
    flags: COMPONENTS_V2,
    components: [container]
  });
}

function buildTicketPanelPayload() {
  return buildPanelPayload(
    new ContainerBuilder()
      .setAccentColor(colors.blue)
      .addMediaGalleryComponents(buildBannerGallery('Central de Suporte'))
      .addSeparatorComponents(buildSeparator())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '## Central de Suporte\n\n' +
            'Precisa de ajuda? Abra um ticket e nossa equipe irá atendê-lo em breve.\n\n' +
            'Horario de atendimento: Seg-Sex, 9h-18h\nDescreva seu problema com detalhes para um atendimento mais rapido.'
        )
      )
      .addSeparatorComponents(buildSeparator())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('ticket_tools')
            .setPlaceholder('Selecione o tipo de atendimento')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              { label: 'Reportar Bug', value: 'ticket_bug', description: 'Informar erro ou falha no sistema.' },
              { label: 'Dúvida Geral', value: 'ticket_question', description: 'Abrir atendimento para tirar dúvidas.' },
              { label: 'Suporte Técnico', value: 'ticket_technical', description: 'Solicitar ajuda técnica.' }
            )
        )
      )
  );
}

function buildRenewPanelPayload() {
  return buildPanelPayload(
    new ContainerBuilder()
      .setAccentColor(colors.orange)
      .addMediaGalleryComponents(buildBannerGallery('Renovacao de Plano'))
      .addSeparatorComponents(buildSeparator())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '## Renovacao de Plano\n\n' +
            'Seu plano expirou ou esta prestes a vencer. Clique em renovar, informe sua chave de acesso e o bot identifica seu projeto para enviar o pagamento.\n\n' +
            'Depois que a equipe confirmar o pagamento, seu sistema e religado automaticamente.'
        )
      )
      .addSeparatorComponents(buildSeparator())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('renew_now').setLabel('Renovar Agora').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('renew_check').setLabel('Ja renovei, verificar acesso').setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

function buildVipPromotionPanelPayload(settings) {
  const coupon = settings?.coupon?.active && settings?.coupon?.code ? settings.coupon : null;
  const promotionActive = Boolean(settings?.retail?.active);
  const boostPercent = getBoostDiscountPercent(settings);
  const title = coupon || promotionActive ? '💎 Promoção VIP ativa' : '💎 Promoção VIP';
  const description = coupon
    ? `O sistema de cupom está ativo.\n\nUse o cupom **\`${coupon.code}\`** para receber **${coupon.percent}% OFF**.`
    : 'No momento não há cupom ativo para exibir neste canal.';
  const fields = [
    `**Desconto de boost**\n${boostPercent > 0 ? `${boostPercent}% OFF enquanto o boost estiver ativo.` : 'Desativado.'}`,
    `**Cupom**\n${coupon ? `\`${coupon.code}\`` : 'Nenhum'}`,
    `**Porcentagem do cupom**\n${coupon ? `${coupon.percent}% OFF` : '0%'}`
  ].join('\n\n');

  return buildPanelPayload(
    new ContainerBuilder()
      .setAccentColor(coupon || promotionActive ? colors.purple : colors.gray)
      .addMediaGalleryComponents(buildBannerGallery(title))
      .addSeparatorComponents(buildSeparator())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${title}\n\n${description}\n\n${fields}\n\n_O desconto final é calculado no contrato conforme os benefícios ativos._`
        )
      )
  );
}

function buildSuggestionsPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.purple)
        .setTitle('Caixa de Sugestões')
        .setDescription('Tem uma ideia para melhorar nosso produto ou servidor? Compartilhe com a gente!')
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('suggestion_open').setLabel('Enviar Sugestão').setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

module.exports = {
  buildRenewPanelPayload,
  buildSuggestionsPanelPayload,
  buildTicketPanelPayload,
  buildVipPromotionPanelPayload,
  PANEL_BANNER_FILE_NAME,
  PANEL_BANNER_PATH,
  PANEL_BANNER_URL,
  withPanelBanner
};
