const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');
const { getSystemSettings } = require('./store');

function brl(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function discounted(value, percent) {
  return value * (1 - percent / 100);
}

function basePriceForPlan(planType, prices) {
  if (planType === 'plan_complete') {
    return Number(prices.complete || prices.premium || 0);
  }

  if (planType === 'plan_pro' || planType === 'plan_lifetime' || planType === 'plan_premium') {
    return Number(prices.premium || 0);
  }

  return Number(prices.basic || 0);
}

function getPlanPricing(planType, settings = {}, couponCode = null) {
  const activeSettings = settings || {};
  const prices = activeSettings.prices || { basic: 50, premium: 250, complete: 350, hosting: 12 };
  const base = basePriceForPlan(planType, prices);
  const promotionPercent = planType === 'plan_pro' || planType === 'plan_lifetime' || planType === 'plan_premium' || planType === 'plan_complete' ? 30 : 20;
  const promotionActive = Boolean(activeSettings.retail?.active);
  const afterPromotion = promotionActive ? discounted(base, promotionPercent) : base;
  const normalizedCode = String(couponCode || '').trim().toUpperCase();
  const configuredCoupon =
    activeSettings.coupon?.active &&
    activeSettings.coupon?.code &&
    Number(activeSettings.coupon?.usesLeft ?? 0) > 0
      ? activeSettings.coupon
      : null;
  const configuredCouponMatches =
    configuredCoupon &&
    normalizedCode &&
    String(configuredCoupon.code).trim().toUpperCase() === normalizedCode;
  const couponMatches = Boolean(configuredCouponMatches);
  const coupon = configuredCouponMatches ? configuredCoupon : null;
  const couponPercent = couponMatches ? Number(coupon.percent || 0) : 0;
  const final = couponMatches ? discounted(afterPromotion, couponPercent) : afterPromotion;

  return {
    base,
    promotionActive,
    promotionPercent,
    afterPromotion,
    coupon,
    couponMatches,
    couponPercent,
    final
  };
}

function priceLine(value, discountPercent, promotionActive) {
  if (!promotionActive) {
    return `${brl(value)} único`;
  }

  return `~~${brl(value)}~~ ${brl(discounted(value, discountPercent))} único (${discountPercent}% OFF)`;
}

function resolveSettings(input = {}) {
  if (typeof input === 'boolean') {
    return {
      promotionActive: input,
      prices: getSystemSettings(process.env.GUILD_ID || '')?.prices || { basic: 50, premium: 250, hosting: 12 }
    };
  }

  const guildId = input.guildId || process.env.GUILD_ID || '';
  const settings = input.settings || getSystemSettings(guildId);

  return {
    promotionActive: input.promotionActive ?? settings.retail.active,
    prices: settings.prices
  };
}

function buildPlansEmbeds(input = {}) {
  const { promotionActive, prices } = resolveSettings(input);
  const settings = input?.settings || getSystemSettings(input.guildId || process.env.GUILD_ID || '');
  const basicPrice = priceLine(prices.basic, 20, promotionActive);
  const premiumPrice = priceLine(prices.premium, 30, promotionActive);
  const promoText = promotionActive
    ? '\n\n🔥 **Promoção ativa:** Básico com 20% OFF e Premium com 30% OFF.'
    : '';
  const couponText = settings?.coupon?.code
    ? settings.coupon.active && Number(settings.coupon.usesLeft ?? 0) > 0
      ? `\n🎟️ **Cupom ativo:** \`${settings.coupon.code}\` com ${settings.coupon.percent}% OFF adicional. Uso único.`
      : `\n🎟️ **Último cupom:** \`${settings.coupon.code}\` ${settings.coupon.status === 'used' ? 'já foi usado' : 'está expirado'}.`
    : '';

  return [
    new EmbedBuilder()
      .setColor(promotionActive ? colors.red : colors.gold)
      .setTitle('Planos para Bot Discord Profissional')
      .setDescription(
        '**Automatize seu servidor com um bot personalizado para vendas, suporte e gerenciamento.**\n\n' +
          'Entrega rápida · Configuração inclusa · Suporte técnico · Painéis profissionais' +
          promoText +
          couponText
      )
      .addFields(
        { name: 'Básico', value: `${basicPrice}\nIdeal para começar com comandos, mensagens e painéis simples.`, inline: true },
        { name: 'Premium', value: `${premiumPrice}\nSistema completo com tickets, automod, relatórios, clientes e /ativar.`, inline: true },
        { name: 'Completo', value: `${brl(prices.complete || prices.premium)}\nAcesso completo com recursos avançados e entrega profissional.`, inline: true },
        { name: 'Hospedagem', value: `${brl(prices.hosting)}/mês\nOpcional, mantém o bot online 24h.`, inline: true }
      )
      .setFooter({ text: 'Escolha um plano pelo botão abaixo. Hospedagem não entra no desconto promocional.' }),

    new EmbedBuilder()
      .setColor(colors.blue)
      .setTitle('Plano Básico')
      .setDescription(
        `**${basicPrice}**\n` +
          `Hospedagem opcional: **${brl(prices.hosting)}/mês**\n\n` +
          'Para servidores que precisam de um bot funcional, bonito e pronto para operar.'
      )
      .addFields(
        {
          name: 'O que você recebe',
          value:
            '✅ Comandos básicos\n' +
            '✅ Sistema de boas-vindas e saída\n' +
            '✅ Sistema de avisos\n' +
            '✅ Painel simples com botões\n' +
            '✅ Logs básicos\n' +
            '✅ Embed personalizado\n' +
            '✅ Configuração inicial do servidor\n' +
            '✅ Manutenções básicas\n' +
            '✅ Mensagem em DMs\n' +
            '✅ Alertas'
        },
        {
          name: 'Não incluso no Básico',
          value:
            '❌ Sistema de tickets\n' +
            '❌ Auto-moderação avançada\n' +
            '❌ Relatórios e analytics\n' +
            '❌ Sistema de baú\n' +
            '❌ Sistema de ausência\n' +
            '❌ Hierarquia\n' +
            '❌ Banner em todos os painéis'
        },
        { name: 'Indicado para', value: 'Comunidades pequenas, bots institucionais e servidores que estão começando.' }
      )
      .setFooter({ text: 'Entrega com configuração inicial do servidor.' }),

    new EmbedBuilder()
      .setColor(colors.purple)
      .setTitle('Plano Premium')
      .setDescription(
        `**${premiumPrice}**\n` +
          `Hospedagem opcional: **${brl(prices.hosting)}/mês** · Suporte por 60 dias\n\n` +
          'Para quem quer um sistema completo de vendas, clientes, suporte e automação.'
      )
      .addFields(
        {
          name: 'Tudo do Básico +',
          value:
            '✅ Sistema de tickets\n' +
            '✅ Auto-moderação avançada\n' +
            '✅ Relatórios e analytics\n' +
            '✅ Sistema de baú\n' +
            '✅ Sistema de ausência\n' +
            '✅ Hierarquia\n' +
            '✅ Banner em todos os painéis'
        },
        {
          name: 'Recursos profissionais',
          value:
            '✅ Licenças e clientes\n' +
            '✅ Alerta de vencimento automático\n' +
            '✅ Relatório semanal automático\n' +
            '✅ Dashboard analytics de membros\n' +
            '✅ Comando /ativar - monta tudo automaticamente'
        },
        { name: 'Indicado para', value: 'Vendedores, comunidades pagas e servidores que precisam operar com fila, clientes e suporte.' }
      )
      .setFooter({ text: 'Plano mais completo para operação profissional.' }),

    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Hospedagem e entrega')
      .setDescription(
        `**Hospedagem opcional: ${brl(prices.hosting)}/mês**\n` +
          'Mantém o bot online 24h sem precisar deixar seu PC ligado.\n\n' +
          '✅ Online 24h/7 dias\n' +
          '✅ Reinicialização automática\n' +
          '✅ Atualizações sem sair do ar\n' +
          '✅ Suporte técnico incluído\n\n' +
          '**Para entrar na fila:** siga as instruções enviadas no ticket.\n' +
          '**Prazo médio:** até 5 dias após a aprovação.\n' +
          '**Ativação:** feita após a validação do atendimento.'
      )
      .setFooter({ text: 'Após clicar no plano, siga as instruções no canal aberto pelo bot.' })
  ];
}

function buildPlansEmbed(promotionActive = false) {
  return buildPlansEmbeds(promotionActive)[0];
}

function buildPlansButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('buy_plan_open').setLabel('Comprar Plano').setStyle(ButtonStyle.Success)
    )
  ];
}

function buildPromotionEmbed(active) {
  return new EmbedBuilder()
    .setColor(active ? colors.red : colors.gray)
    .setTitle(active ? '🔥 Promoção ativada' : 'Promoção desativada')
    .setDescription(
      active
        ? 'O modo de desconto está ativo: Plano Básico com 20% OFF e Plano Premium com 30% OFF. A hospedagem continua sem alteração.'
        : 'O modo de desconto foi desativado. Os planos voltaram aos valores normais.'
    )
    .setTimestamp();
}

module.exports = {
  buildPlansButtons,
  buildPlansEmbed,
  buildPlansEmbeds,
  buildPromotionEmbed,
  getPlanPricing
};
