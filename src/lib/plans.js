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

function hasServerBoostDiscount(member) {
  const boosterRoleId = member?.guild?.roles?.premiumSubscriberRole?.id;
  return Boolean(member?.premiumSince || (boosterRoleId && member?.roles?.cache?.has(boosterRoleId)));
}

function getBoostDiscountPercent(settings = {}) {
  const percent = Number(settings?.boost?.percent ?? 5);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return 0;
  }

  return percent;
}

function basePriceForPlan(planType, prices) {
  if (planType === 'plan_monthly') {
    return Number(prices.monthly ?? prices.hosting ?? 12);
  }

  if (planType === 'plan_fivem_fac') {
    return Number(prices.fivemFac ?? 150);
  }

  if (planType === 'plan_lifetime') {
    return Number(prices.lifetime ?? prices.premium ?? 0);
  }

  if (planType === 'plan_pro') {
    return Number(prices.premium || 0);
  }

  return Number(prices.basic || 0);
}

function getPlanPricing(planType, settings = {}, couponCode = null, options = {}) {
  const activeSettings = settings || {};
  const prices = activeSettings.prices || { basic: 50, premium: 250, lifetime: 450, fivemFac: 150, hosting: 12, monthly: 12 };
  const base = basePriceForPlan(planType, prices);
  const promotionPercent = planType === 'plan_pro' || planType === 'plan_lifetime' ? 30 : 20;
  const promotionActive = Boolean(activeSettings.retail?.active);
  const afterPromotion = promotionActive ? discounted(base, promotionPercent) : base;
  const coupon = activeSettings.coupon?.active && activeSettings.coupon?.code ? activeSettings.coupon : null;
  const couponMatches =
    coupon &&
    couponCode &&
    String(coupon.code).trim().toLowerCase() === String(couponCode).trim().toLowerCase();
  const afterCoupon = couponMatches ? discounted(afterPromotion, Number(coupon.percent || 0)) : afterPromotion;
  const boostEligible = Boolean(options.boostActive ?? hasServerBoostDiscount(options.member));
  const boostPercent = boostEligible ? getBoostDiscountPercent(activeSettings) : 0;
  const boostActive = boostEligible && boostPercent > 0;
  const final = boostActive ? discounted(afterCoupon, boostPercent) : afterCoupon;

  return {
    base,
    promotionActive,
    promotionPercent,
    afterPromotion,
    afterCoupon,
    coupon,
    couponMatches,
    couponPercent: couponMatches ? Number(coupon.percent || 0) : 0,
    boostActive,
    boostPercent,
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
      prices: getSystemSettings(process.env.GUILD_ID || '')?.prices || { basic: 50, premium: 250, lifetime: 450, fivemFac: 150, hosting: 12 }
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
  const lifetimePrice = priceLine(prices.lifetime ?? 450, 30, promotionActive);
  const fivemFacPrice = priceLine(prices.fivemFac ?? 150, 20, promotionActive);
  const monthlyPrice = `${brl(prices.monthly ?? prices.hosting ?? 12)}/mês`;
  const promoText = promotionActive
    ? '\n\n🔥 **Promoção ativa:** Básico com 20% OFF e Premium com 30% OFF.'
    : '';
  const couponText = settings?.coupon?.active && settings?.coupon?.code
    ? `\n🎟️ **Cupom ativo:** \`${settings.coupon.code}\` com ${settings.coupon.percent}% OFF adicional.`
    : '';
  const boostPercent = getBoostDiscountPercent(settings);
  const boostText = boostPercent > 0
    ? `\n💎 **Boost no servidor:** quem estiver impulsionando o servidor recebe ${boostPercent}% OFF enquanto o boost estiver ativo.`
    : '';

  return [
    new EmbedBuilder()
      .setColor(promotionActive ? colors.red : colors.gold)
      .setTitle('Planos para Bot Discord Profissional')
      .setDescription(
        '**Automatize seu servidor com um bot personalizado para vendas, suporte e gerenciamento.**\n\n' +
          'Entrega rápida · Configuração inclusa · Suporte técnico · Painéis profissionais' +
          promoText +
          couponText +
          boostText
      )
      .addFields(
        { name: 'Básico', value: `${basicPrice}\nIdeal para começar com comandos, mensagens e painéis simples.`, inline: true },
        { name: 'Premium', value: `${premiumPrice}\nSistema completo com tickets, automod, relatórios, clientes e /ativar.`, inline: true },
        { name: 'Vitalício', value: `${lifetimePrice}\nPlano completo com acesso vitalício ao bot contratado.`, inline: true },
        { name: 'FiveM FAC', value: `${fivemFacPrice}\nBot e estrutura para facção FiveM operar com registro, tickets e hierarquia.`, inline: true },
        { name: 'Plano Mensal', value: `${monthlyPrice}\nHospedagem inclusa, cupom ativo aceito, contrato, pagamento mensal e liberação por código após criar senha.`, inline: true },
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
            '✅ Comando /ativar - monta tudo automaticamente'
        },
        { name: 'Indicado para', value: 'Vendedores, comunidades pagas e servidores que precisam operar com fila, clientes e suporte.' }
      )
      .setFooter({ text: 'Plano mais completo para operação profissional.' }),

    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Plano Vitalício')
      .setDescription(
        `**${lifetimePrice}**\n` +
          `Hospedagem opcional: **${brl(prices.hosting)}/mês**\n\n` +
          'Para quem quer contratar uma vez e manter o acesso vitalício ao bot adquirido.'
      )
      .addFields(
        {
          name: 'Inclui',
          value:
            '✅ Tudo do Premium\n' +
            '✅ Acesso vitalício ao bot contratado\n' +
            '✅ Prioridade na implantação\n' +
            '✅ Suporte estendido após entrega'
        },
        { name: 'Indicado para', value: 'Clientes que querem um projeto definitivo, sem renovação do plano do bot.' }
      )
      .setFooter({ text: 'Hospedagem mensal continua opcional e separada.' }),

    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Plano FiveM FAC')
      .setDescription(
        `**${fivemFacPrice}**\n` +
          `Hospedagem opcional: **${brl(prices.hosting)}/mês**\n\n` +
          'Para facções FiveM que precisam de organização, recrutamento, suporte e controle interno no Discord.'
      )
      .addFields(
        {
          name: 'O que vem no plano',
          value:
            '✅ Bot personalizado para facção FiveM\n' +
            '✅ Painel de recrutamento e registro\n' +
            '✅ Sistema de tickets para membros e suporte\n' +
            '✅ Hierarquia de cargos da facção\n' +
            '✅ Logs de ações e controle interno\n' +
            '✅ Canais e permissões organizados\n' +
            '✅ Configuração inicial no seu servidor'
        },
        { name: 'Indicado para', value: 'Facções, organizações e grupos FiveM que querem atendimento e gestão dentro do Discord.' }
      )
      .setFooter({ text: 'Pode ser adaptado à identidade e regras da sua facção.' }),

    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Plano Mensal')
      .setDescription(
        `**${monthlyPrice}**\n\n` +
          'Para clientes que querem pagar mensalmente com hospedagem inclusa, contrato, pagamento Pix e liberacao controlada depois da criacao da senha.'
      )
      .addFields(
        {
          name: 'Fluxo incluso',
          value:
            '✅ Ticket em categoria Plano Mensal\n' +
            '✅ Contrato enviado automaticamente\n' +
            '✅ Cupom aplicado antes do contrato\n' +
            '✅ Pagamento mensal pelo sistema configurado\n' +
            '✅ Hospedagem inclusa no valor mensal\n' +
            '✅ Chave de acesso enviada ao cliente\n' +
            '✅ Codigo de liberacao gerado apos criar senha'
        },
        { name: 'Organizacao', value: 'Os tickets mensais sao separados em categorias de ate 10 canais.' }
      )
      .setFooter({ text: 'Indicado para assinatura mensal com liberacao controlada.' }),

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
      new ButtonBuilder().setCustomId('plan_basic').setLabel('Contratar Básico').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('plan_pro').setLabel('Contratar Premium').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('plan_lifetime').setLabel('Contratar Vitalício').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('plan_fivem_fac').setLabel('Contratar FiveM FAC').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('plan_monthly').setLabel('Plano Mensal').setStyle(ButtonStyle.Secondary)
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
  getBoostDiscountPercent,
  hasServerBoostDiscount,
  getPlanPricing
};
