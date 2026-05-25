const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const crypto = require('node:crypto');
const { colors } = require('../config/setup');
const { toComponentsV2 } = require('../lib/componentsV2');
const { privateReply } = require('../lib/replies');
const { getGuildSetup } = require('../lib/store');

const BULK_DELETE_LIMIT = 100;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const pendingCleanups = new Map();

function envNumber(key, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function cleanConfig() {
  return {
    maxMessages: envNumber('CLEAN_MAX_MESSAGES', BULK_DELETE_LIMIT, 1, BULK_DELETE_LIMIT),
    scanLimit: envNumber('CLEAN_SCAN_LIMIT', 200, 1, 1000),
    confirmTtlMs: envNumber('CLEAN_CONFIRM_TTL_MS', 5 * 60 * 1000, 30 * 1000, 30 * 60 * 1000),
    logChannelId: String(process.env.CLEAN_LOG_CHANNEL_ID || '').trim(),
    skipPinned: !['0', 'false', 'no', 'nao'].includes(String(process.env.CLEAN_SKIP_PINNED || 'true').toLowerCase())
  };
}

function hasChannelPermission(channel, member, permission) {
  return Boolean(channel?.permissionsFor(member)?.has(permission));
}

function canUseClean(channel, member, botMember) {
  if (!hasChannelPermission(channel, member, PermissionFlagsBits.ManageMessages)) {
    return { ok: false, reason: 'Voce precisa da permissao **Gerenciar mensagens** nesse canal.' };
  }

  if (!hasChannelPermission(channel, botMember, PermissionFlagsBits.ViewChannel)) {
    return { ok: false, reason: 'O bot nao consegue ver esse canal.' };
  }

  if (!hasChannelPermission(channel, botMember, PermissionFlagsBits.ReadMessageHistory)) {
    return { ok: false, reason: 'O bot precisa da permissao **Ler historico de mensagens** nesse canal.' };
  }

  if (!hasChannelPermission(channel, botMember, PermissionFlagsBits.ManageMessages)) {
    return { ok: false, reason: 'O bot precisa da permissao **Gerenciar mensagens** nesse canal.' };
  }

  return { ok: true };
}

function buildConfirmPayload(request) {
  const targetUserLine = request.targetUserId
    ? `<@${request.targetUserId}>\nID: \`${request.targetUserId}\``
    : 'Nenhum filtro. Vou limpar mensagens recentes do canal.';

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.orange)
        .setTitle('Confirmar limpeza de mensagens')
        .setDescription(
          'Esta acao usa somente o token oficial do bot e apaga mensagens do servidor onde o bot tem permissao.\n\n' +
            'Nao apaga DMs pessoais, amizades ou conversas privadas.'
        )
        .addFields(
          { name: 'Canal', value: `<#${request.channelId}>`, inline: true },
          { name: 'Quantidade maxima', value: String(request.amount), inline: true },
          { name: 'Usuario filtrado', value: targetUserLine, inline: false },
          { name: 'Regra de idade', value: 'Mensagens com mais de 14 dias nao serao apagadas por bulkDelete.', inline: false }
        )
        .setFooter({ text: `Solicitado por ${request.requesterTag}` })
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`clean:confirm:${request.id}`)
          .setLabel('Confirmar limpeza')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`clean:cancel:${request.id}`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function buildResultPayload(title, description, color = colors.default) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
    ],
    components: []
  };
}

async function collectMessages(channel, request, config) {
  const cutoff = Date.now() - FOURTEEN_DAYS_MS;
  const collected = [];
  let before;
  let scanned = 0;
  const scanLimit = Math.max(request.amount, config.scanLimit);

  while (collected.length < request.amount && scanned < scanLimit) {
    const limit = Math.min(100, scanLimit - scanned);
    const fetched = await channel.messages.fetch({ limit, before }).catch((error) => {
      throw new Error(`Nao consegui buscar mensagens: ${error.message}`);
    });

    if (!fetched.size) break;
    scanned += fetched.size;
    before = fetched.last()?.id;

    for (const message of fetched.values()) {
      if (message.createdTimestamp <= cutoff) continue;
      if (config.skipPinned && message.pinned) continue;
      if (request.targetUserId && message.author?.id !== request.targetUserId) continue;
      collected.push(message);
      if (collected.length >= request.amount) break;
    }

    if (fetched.size < limit) break;
  }

  return { messages: collected, scanned };
}

async function writeCleanLog(interaction, request, result) {
  const setup = getGuildSetup(interaction.guild.id);
  const logChannelId = cleanConfig().logChannelId || setup?.channels?.modLogs || setup?.channels?.generalLogs;
  const line = [
    `guild=${interaction.guild.id}`,
    `channel=${request.channelId}`,
    `requester=${request.requesterId}`,
    `target=${request.targetUserId || 'all'}`,
    `requested=${request.amount}`,
    `deleted=${result.deletedCount}`,
    `scanned=${result.scanned}`
  ].join(' ');

  console.log(`[OrvitekClean] ${line}`);

  const logChannel = logChannelId ? await interaction.guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (!logChannel?.isTextBased()) return;

  await logChannel.send(toComponentsV2({
    embeds: [
      new EmbedBuilder()
        .setColor(colors.gold)
        .setTitle('Limpeza de mensagens executada')
        .addFields(
          { name: 'Executor', value: `<@${request.requesterId}>`, inline: true },
          { name: 'Canal', value: `<#${request.channelId}>`, inline: true },
          { name: 'Usuario filtrado', value: request.targetUserId ? `<@${request.targetUserId}>\n\`${request.targetUserId}\`` : 'Sem filtro', inline: true },
          { name: 'Solicitadas', value: String(request.amount), inline: true },
          { name: 'Apagadas', value: String(result.deletedCount), inline: true },
          { name: 'Escaneadas', value: String(result.scanned), inline: true },
          { name: 'Motivo', value: request.reason || 'Nao informado' }
        )
        .setTimestamp()
    ]
  })).catch(() => null);
}

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply(privateReply('Este comando so pode ser usado em servidores.'));
    return;
  }

  const config = cleanConfig();
  const amount = interaction.options.getInteger('quantidade', true);
  const targetUser = interaction.options.getUser('usuario', false);
  const targetChannel = interaction.options.getChannel('canal', false) || interaction.channel;
  const reason = interaction.options.getString('motivo', false) || '';

  if (amount < 1 || amount > config.maxMessages) {
    await interaction.reply(privateReply(`Escolha uma quantidade entre 1 e ${config.maxMessages}.`));
    return;
  }

  if (!targetChannel?.isTextBased() || typeof targetChannel.bulkDelete !== 'function') {
    await interaction.reply(privateReply('Selecione um canal de texto do servidor que suporte limpeza de mensagens.'));
    return;
  }

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  const permissionCheck = canUseClean(targetChannel, interaction.member, botMember);
  if (!permissionCheck.ok) {
    await interaction.reply(privateReply(permissionCheck.reason));
    return;
  }

  const id = crypto.randomUUID();
  const request = {
    id,
    guildId: interaction.guild.id,
    channelId: targetChannel.id,
    requesterId: interaction.user.id,
    requesterTag: interaction.user.tag,
    targetUserId: targetUser?.id || null,
    amount,
    reason,
    createdAt: Date.now()
  };

  pendingCleanups.set(id, request);
  setTimeout(() => pendingCleanups.delete(id), config.confirmTtlMs).unref?.();

  console.log(`[OrvitekClean] solicitacao criada guild=${request.guildId} channel=${request.channelId} requester=${request.requesterId} target=${request.targetUserId || 'all'} amount=${amount}`);
  await interaction.reply(toComponentsV2(buildConfirmPayload(request), { ephemeral: true }));
}

async function handleButton(interaction) {
  if (!interaction.customId?.startsWith('clean:')) return false;

  const [, action, id] = interaction.customId.split(':');
  const request = pendingCleanups.get(id);
  if (!request) {
    await interaction.reply(toComponentsV2(buildResultPayload('Limpeza expirada', 'Execute `/clean` novamente para criar uma nova confirmacao.', colors.red), { ephemeral: true }));
    return true;
  }

  if (interaction.user.id !== request.requesterId) {
    await interaction.reply(privateReply('Apenas quem iniciou esta limpeza pode confirmar ou cancelar.'));
    return true;
  }

  if (action === 'cancel') {
    pendingCleanups.delete(id);
    await interaction.update(toComponentsV2(buildResultPayload('Limpeza cancelada', 'Nenhuma mensagem foi apagada.', colors.gray), { ephemeral: true }));
    return true;
  }

  if (action !== 'confirm') return false;

  await interaction.deferUpdate();

  const channel = await interaction.guild.channels.fetch(request.channelId).catch(() => null);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  const permissionCheck = canUseClean(channel, interaction.member, botMember);
  if (!permissionCheck.ok) {
    pendingCleanups.delete(id);
    await interaction.editReply(toComponentsV2(buildResultPayload('Erro na limpeza', permissionCheck.reason, colors.red)));
    return true;
  }

  try {
    const config = cleanConfig();
    const { messages, scanned } = await collectMessages(channel, request, config);
    if (!messages.length) {
      pendingCleanups.delete(id);
      await interaction.editReply(toComponentsV2(buildResultPayload(
        'Nada para apagar',
        'Nao encontrei mensagens elegiveis nos ultimos 14 dias com os filtros escolhidos.',
        colors.orange
      )));
      return true;
    }

    const deleted = await channel.bulkDelete(messages, false);
    const result = { deletedCount: deleted.size, scanned };
    pendingCleanups.delete(id);
    await writeCleanLog(interaction, request, result);
    const pinnedLine = cleanConfig().skipPinned
      ? 'Mensagens fixadas foram preservadas conforme a configuracao.'
      : 'Mensagens fixadas tambem estavam elegiveis para limpeza.';
    await interaction.editReply(toComponentsV2(buildResultPayload(
      'Limpeza concluida',
      [
        `Mensagens apagadas: **${deleted.size}**.`,
        `Canal: <#${request.channelId}>.`,
        request.targetUserId ? `Filtro de usuario: <@${request.targetUserId}> (\`${request.targetUserId}\`).` : 'Filtro de usuario: nenhum.',
        `Mensagens com mais de 14 dias foram preservadas. ${pinnedLine}`
      ].join('\n')
    )));
    return true;
  } catch (error) {
    pendingCleanups.delete(id);
    console.error('[OrvitekClean] erro ao limpar mensagens:', error);
    await interaction.editReply(toComponentsV2(buildResultPayload('Erro na limpeza', error.message, colors.red)));
    return true;
  }
}

module.exports = {
  allowNonOwner: true,
  data: new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Limpa mensagens recentes de um canal do servidor com confirmacao segura.')
    .addIntegerOption((option) =>
      option
        .setName('quantidade')
        .setDescription('Quantidade maxima de mensagens para apagar.')
        .setMinValue(1)
        .setMaxValue(BULK_DELETE_LIMIT)
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Opcional: apaga somente mensagens desse Discord ID no canal.')
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('canal')
        .setDescription('Opcional: canal onde a limpeza sera feita. Se vazio, usa o canal atual.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('motivo')
        .setDescription('Motivo para registrar no log.')
        .setMaxLength(200)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  execute,
  handleButton
};
