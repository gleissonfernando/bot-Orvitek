require('dotenv').config();

const { Client, Collection, EmbedBuilder, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const commands = require('./commands/setupCommands');
const { colors } = require('./config/setup');
const {
  handleButton,
  handleSelect,
  handleModal,
  publishHostingReminder,
  deleteHostingAccess,
  restoreDeletedPanel
} = require('./lib/interactions');
const { isOwnerRole } = require('./lib/permissions');
const { privateReply } = require('./lib/replies');
const { addWarning, expireClient, getGuildSetup, getHostingCycleKey, getHostingGraceDeadline, getReport, listClients } = require('./lib/store');
const { buildWelcomeChannelEmbed, buildWelcomeDmEmbed } = require('./lib/welcome');

if (!process.env.DISCORD_TOKEN) {
  throw new Error('Configure DISCORD_TOKEN no arquivo .env.');
}

const LIFECYCLE_LOG_CHANNEL_ID = process.env.LIFECYCLE_LOG_CHANNEL_ID || '1505195775381209188';
let shuttingDown = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

client.commands = new Collection();

for (const command of commands) {
  client.commands.set(command.data.name, command);
}

async function sendLog(guild, channelKey, embed) {
  const setup = getGuildSetup(guild.id);
  const channelId = setup?.channels?.[channelKey];
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

async function sendLifecycleLog(readyClient, title, description, color) {
  const channel = await readyClient.channels.fetch(LIFECYCLE_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .addFields(
          { name: 'Bot', value: readyClient.user?.tag || 'desconhecido', inline: true },
          { name: 'Horário', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setTimestamp()
    ]
  }).catch(() => null);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Encerrando bot por ${signal}.`);
  if (client.isReady()) {
    await sendLifecycleLog(client, 'Bot desligado', `O processo recebeu ${signal} e está sendo encerrado.`, colors.red);
  }

  client.destroy();
  process.exit(0);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}.`);
  await sendLifecycleLog(readyClient, 'Bot ligado', 'O bot foi iniciado e está online.', colors.default);
  startSchedulers(readyClient);
});

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.on(Events.GuildMemberAdd, async (member) => {
  const setup = getGuildSetup(member.guild.id);
  const verifyChannelId = setup?.channels?.verify;
  const announcementsId = setup?.channels?.announcements || process.env.WELCOME_CHANNEL_ID;

  if (setup?.roles?.unverified) {
    await member.roles.add(setup.roles.unverified).catch(() => null);
  }

  await member
    .send({
      embeds: [buildWelcomeDmEmbed(member, verifyChannelId)]
    })
    .catch((error) => console.warn(`Nao foi possivel enviar DM para ${member.user.tag}: ${error.message}`));

  if (announcementsId) {
    const channel = await member.guild.channels.fetch(announcementsId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [buildWelcomeChannelEmbed(member, verifyChannelId)] });
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const joinedAt = member.joinedAt ? member.joinedAt.getTime() : Date.now();
  const days = Math.max(0, Math.floor((Date.now() - joinedAt) / 86400000));
  const roles = member.roles?.cache
    ?.filter((role) => role.id !== member.guild.id)
    .map((role) => role.name)
    .join(', ') || 'sem cargos';

  await sendLog(
    member.guild,
    'generalLogs',
    new EmbedBuilder()
      .setColor(colors.gray)
      .setTitle('Membro saiu do servidor')
      .addFields(
        { name: 'Usuário', value: member.user?.tag || member.id, inline: true },
        { name: 'Tempo no servidor', value: `${days} dia(s)`, inline: true },
        { name: 'Cargos', value: roles.slice(0, 1000) || 'sem cargos' }
      )
      .setTimestamp()
  );
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  const setup = getGuildSetup(message.guild.id);
  const forbiddenWords = (process.env.BAD_WORDS || 'palavrao').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean);
  const hasBadWord = forbiddenWords.some((word) => message.content.toLowerCase().includes(word));
  const repeated = /(.)\1{8,}/.test(message.content);

  if (!hasBadWord && !repeated) return;

  await message.delete().catch(() => null);
  const reason = hasBadWord ? 'palavra bloqueada' : 'spam';
  const record = addWarning(message.guild.id, message.author.id, reason);

  await message.author.send(`Sua mensagem foi removida por ${reason}. Aviso ${record.strikes}/4.`).catch(() => null);

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member) {
    if (record.strikes === 2) {
      await member.timeout(60 * 60 * 1000, 'Auto-moderação: segunda infração').catch(() => null);
    } else if (record.strikes === 3) {
      await member.kick('Auto-moderação: terceira infração').catch(() => null);
    } else if (record.strikes >= 4) {
      await member.ban({ reason: 'Auto-moderação: quarta infração' }).catch(() => null);
    }
  }

  await sendLog(
    message.guild,
    'modLogs',
    new EmbedBuilder()
      .setColor(colors.red)
      .setTitle('Auto-moderação')
      .addFields(
        { name: 'Usuário', value: message.author.tag, inline: true },
        { name: 'Motivo', value: reason, inline: true },
        { name: 'Infrações', value: String(record.strikes), inline: true }
      )
      .setTimestamp()
  );
});

client.on(Events.MessageDelete, async (message) => {
  try {
    await restoreDeletedPanel(message);
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (await handleButton(interaction)) return;
    }

    if (interaction.isModalSubmit()) {
      if (await handleModal(interaction)) return;
    }

    if (interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) {
      if (await handleSelect(interaction)) return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== 'ativar' && !isOwnerRole(interaction.member)) {
      await interaction.reply(privateReply('Apenas quem tem o cargo Dono pode usar comandos slash.'));
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (error) {
    if (error?.code === 10062 || String(error?.message || '').includes('Unknown interaction')) {
      console.warn(`Interação expirada ignorada: ${interaction.id}`);
      return;
    }

    console.error(error);

    if (interaction.guild) {
      await sendLog(
        interaction.guild,
        'generalLogs',
        new EmbedBuilder().setColor(colors.red).setTitle('Erro interno').setDescription(String(error.stack || error.message || error)).setTimestamp()
      );
    }

    const payload = privateReply('Ocorreu um erro ao executar esta ação.');
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

function startSchedulers(readyClient) {
  setInterval(() => checkExpirations(readyClient), 60 * 60 * 1000);
  setInterval(() => checkHostingBilling(readyClient), 60 * 60 * 1000);
  setInterval(() => sendWeeklyReports(readyClient), 60 * 60 * 1000);
  checkExpirations(readyClient).catch(console.error);
  checkHostingBilling(readyClient).catch(console.error);
}

async function checkExpirations(readyClient) {
  for (const guild of readyClient.guilds.cache.values()) {
    const setup = getGuildSetup(guild.id);
    if (!setup?.roles) continue;

    const clients = listClients(guild.id, 'active');
    for (const clientRecord of clients) {
      if (!clientRecord.expiresAt) continue;
      const expiresAt = new Date(clientRecord.expiresAt);
      const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000);
      const user = await readyClient.users.fetch(clientRecord.userId).catch(() => null);

      if (daysLeft === 7 && user) {
        await user
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(colors.orange)
                .setTitle('⚠️ Seu plano vence em breve!')
                .setDescription(`Olá ${user.username}! Seu plano expira em 7 dias. Renove agora para não perder o acesso.`)
            ]
          })
          .catch(() => null);
      }

      if (daysLeft <= 0) {
        const member = await guild.members.fetch(clientRecord.userId).catch(() => null);
        if (member) {
          if (setup.roles.active) await member.roles.remove(setup.roles.active).catch(() => null);
          if (setup.roles.vip) await member.roles.remove(setup.roles.vip).catch(() => null);
          if (setup.roles.expired) await member.roles.add(setup.roles.expired).catch(() => null);
        }
        expireClient(guild.id, clientRecord.userId);
      }
    }
  }
}

async function checkHostingBilling(readyClient) {
  for (const guild of readyClient.guilds.cache.values()) {
    const setup = getGuildSetup(guild.id);
    if (!setup?.roles) continue;

    const clients = listClients(guild.id, null);
    for (const clientRecord of clients) {
      if (clientRecord.paymentRejectDeleteAt && Date.now() >= new Date(clientRecord.paymentRejectDeleteAt).getTime()) {
        await deleteHostingAccess(guild, clientRecord, {
          reason: 'Pagamento recusado sem regularização em 3 horas',
          byUserId: null
        });
        continue;
      }

      if (!clientRecord.hostingDueAt || clientRecord.hostingStatus === 'deleted') {
        continue;
      }

      const dueAt = new Date(clientRecord.hostingDueAt);
      const graceUntil = clientRecord.hostingGraceUntil ? new Date(clientRecord.hostingGraceUntil) : getHostingGraceDeadline(dueAt);
      const cycle = getHostingCycleKey(dueAt);
      const now = Date.now();

      if (clientRecord.hostingPaymentStatus !== 'paid' && clientRecord.hostingReminderCycle !== cycle && now >= dueAt.getTime()) {
        await publishHostingReminder(guild, clientRecord);
      }

      if (clientRecord.hostingPaymentStatus !== 'paid' && now >= graceUntil.getTime()) {
        await deleteHostingAccess(guild, clientRecord, {
          reason: 'Tolerância da hospedagem expirada',
          byUserId: null
        });
      }
    }
  }
}

async function sendWeeklyReports(readyClient) {
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() !== 20) return;

  for (const guild of readyClient.guilds.cache.values()) {
    const setup = getGuildSetup(guild.id);
    if (!setup?.channels?.reports) continue;
    const channel = await guild.channels.fetch(setup.channels.reports).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const report = getReport(guild.id);
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.default)
          .setTitle(`Relatório Semanal — ${new Intl.DateTimeFormat('pt-BR').format(now)}`)
          .setDescription(
            `Membros totais: ${guild.memberCount}\n` +
              `✅ Clientes ativos: ${report.activeClients}\n` +
              `⏳ Clientes expirados: ${report.expiredClients}\n` +
              `Tickets abertos: ${report.openTickets}\n` +
              `Tickets resolvidos: ${report.resolvedTickets}\n` +
              '⏱️ Tempo médio de resposta: 0 min\n' +
              `⭐ Avaliação média: ${report.averageRating.toFixed(1)}/5`
          )
      ]
    });
  }
}

client.login(process.env.DISCORD_TOKEN);
