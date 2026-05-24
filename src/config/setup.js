const { ChannelType, PermissionFlagsBits } = require('discord.js');

const colors = {
  default: 0x2ed573,
  gold: 0xffd700,
  red: 0xff4757,
  orange: 0xff6b35,
  blue: 0x3742fa,
  purple: 0x9c59b6,
  gray: 0x747d8c,
  darkGray: 0x57606f
};

const roleSpecs = [
  {
    key: 'owner',
    name: 'Dono',
    color: colors.gold,
    permissions: [PermissionFlagsBits.Administrator]
  },
  {
    key: 'admin',
    name: 'Administrador',
    color: colors.red,
    permissions: [PermissionFlagsBits.Administrator]
  },
  {
    key: 'moderator',
    name: 'Moderador',
    color: colors.orange,
    permissions: [
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers
    ]
  },
  {
    key: 'support',
    name: 'Suporte',
    color: colors.blue,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
  },
  {
    key: 'vip',
    name: 'Cliente VIP',
    color: colors.purple,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'proPlan',
    name: 'Plano Pro',
    color: colors.purple,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'queue',
    name: 'Na Fila',
    color: colors.orange,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'development',
    name: 'Bot em Desenvolvimento',
    color: colors.blue,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'delivered',
    name: 'Bot Entregue',
    color: colors.default,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'active',
    name: 'Cliente Ativo',
    color: colors.default,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  },
  {
    key: 'expired',
    name: 'Cliente Expirado',
    color: colors.gray,
    permissions: [PermissionFlagsBits.ViewChannel]
  },
  {
    key: 'unverified',
    name: 'Não Verificado',
    color: colors.darkGray,
    permissions: [PermissionFlagsBits.ViewChannel]
  },
  {
    key: 'futureClient',
    name: 'Futuro Cliente',
    color: 0x95a5a6,
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  }
];

const staffRoleKeys = ['owner', 'admin', 'moderator', 'support'];
const adminRoleKeys = ['owner', 'admin'];

const categories = [
  {
    key: 'info',
    name: '📢 INFORMAÇÕES',
    oldName: 'INFORMAÇÕES',
    channels: [
      { key: 'announcements', name: '📢・anúncios', oldName: 'anúncios', readOnly: true, everyone: true },
      { key: 'rules', name: '📜・regras', oldName: 'regras', readOnly: true, everyone: true },
      { key: 'howItWorks', name: 'ℹ️・como-funciona', oldName: 'como-funciona', readOnly: true, everyone: true },
      { key: 'faq', name: '❓・faq', oldName: 'faq', readOnly: true, everyone: true }
    ]
  },
  {
    key: 'verification',
    name: '✅ VERIFICAÇÃO',
    oldName: 'VERIFICAÇÃO',
    channels: [{ key: 'verify', name: '✅・verificar-acesso', oldName: 'verificar-acesso', roleKeys: ['unverified'], denyEveryone: true }]
  },
  {
    key: 'store',
    name: '🛒 LOJA',
    oldName: 'LOJA',
    channels: [
      { key: 'plans', name: '💳・planos-e-precos', oldName: 'planos-e-precos', everyone: true },
      { key: 'promotions', name: '🎁・promoções', oldName: 'promoções', everyone: true },
      { key: 'buyNow', name: '🛒・comprar-agora', oldName: 'comprar-agora', everyone: true }
    ]
  },
  {
    key: 'customers',
    name: '👥 CLIENTES',
    oldName: 'CLIENTES',
    channels: [
      { key: 'clientArea', name: '👤・area-do-cliente', oldName: 'area-do-cliente', roleKeys: ['active', 'vip'], denyEveryone: true },
      { key: 'myAccess', name: '🔑・meus-acessos', oldName: 'meus-acessos', roleKeys: ['active', 'vip'], denyEveryone: true },
      { key: 'renewPlan', name: '♻️・renovar-plano', oldName: 'renovar-plano', roleKeys: ['expired', 'active'], denyEveryone: true },
      { key: 'vipOnly', name: '💎・vip-exclusivo', oldName: 'vip-exclusivo', roleKeys: ['vip'], denyEveryone: true }
    ]
  },
  {
    key: 'supportCategory',
    name: '🎫 SUPORTE',
    oldName: 'SUPORTE',
    channels: [
      { key: 'openTicket', name: '🎫・abrir-ticket', oldName: 'abrir-ticket', roleKeys: ['futureClient', 'active', 'vip'], denyEveryone: true },
      { key: 'supportRules', name: '📌・regras-suporte', oldName: 'regras-suporte', readOnly: true, roleKeys: ['futureClient', 'active', 'vip'], denyEveryone: true }
    ]
  },
  {
    key: 'staff',
    name: '🛡️ STAFF',
    oldName: 'STAFF',
    channels: [
      { key: 'generalLogs', name: '📋・logs-gerais', oldName: 'logs-gerais', roleKeys: staffRoleKeys, denyEveryone: true },
      { key: 'ticketLogs', name: '🎟️・logs-tickets', oldName: 'logs-tickets', roleKeys: staffRoleKeys, denyEveryone: true },
      { key: 'modLogs', name: '🛡️・logs-moderação', oldName: 'logs-moderação', roleKeys: staffRoleKeys, denyEveryone: true },
      { key: 'reports', name: '📊・relatórios', oldName: 'relatórios', roleKeys: adminRoleKeys, denyEveryone: true },
      { key: 'staffChat', name: '💬・chat-staff', oldName: 'chat-staff', roleKeys: staffRoleKeys, denyEveryone: true }
    ]
  },
  {
    key: 'community',
    name: '💬 COMUNIDADE',
    oldName: 'COMUNIDADE',
    channels: [
      { key: 'general', name: '💬・geral', oldName: 'geral', roleKeys: ['active', 'vip'], denyEveryone: true },
      { key: 'offTopic', name: '☕・off-topic', oldName: 'off-topic', roleKeys: ['active', 'vip'], denyEveryone: true },
      { key: 'suggestions', name: '💡・sugestões', oldName: 'sugestões', roleKeys: ['active', 'vip'], denyEveryone: true },
      { key: 'reviews', name: '⭐・avaliações', oldName: 'avaliações', roleKeys: ['active', 'vip'], denyEveryone: true }
    ]
  }
];

const channelType = ChannelType.GuildText;

module.exports = {
  adminRoleKeys,
  categories,
  channelType,
  colors,
  roleSpecs,
  staffRoleKeys
};
