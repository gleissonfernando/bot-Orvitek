const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');
const { toComponentsV2 } = require('./componentsV2');

async function sendDmPanel(user, embed, files = [], components = []) {
  const payload = embed?.embeds || embed?.components || embed?.content
    ? { ...embed }
    : { embeds: [embed] };

  if (files.length) {
    payload.files = files;
  }

  if (components.length) {
    payload.components = [...(payload.components || []), ...components];
  }

  return user.send(toComponentsV2(payload)).then(() => true).catch(() => false);
}

function buildVerificationSuccessDm(guildName) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('✅ Verificação concluída')
    .setDescription(
      `Sua verificação em **${guildName}** foi concluída com sucesso.\n\n` +
        'Você agora tem acesso aos canais liberados para membros verificados.'
    )
    .addFields(
      { name: 'Próximo passo', value: 'Leia os canais de informações e escolha o plano ideal para você.' },
      { name: 'Precisa de ajuda?', value: 'Abra um ticket no servidor e explique sua dúvida com detalhes.' }
    )
    .setFooter({ text: 'Bem-vindo(a)! Obrigado por fazer parte da nossa comunidade.' })
    .setTimestamp();
}

function buildDashboardVerificationCodeDm({ guildName, code, expiresAt }) {
  const expiresText = expiresAt ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>` : 'em alguns minutos';

  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Código de acesso da dashboard')
    .setDescription(
      `Recebemos uma solicitação de login na dashboard de **${guildName}**.\n\n` +
        'Digite o código abaixo na dashboard. Se precisar gerar outro código, use **/verificar site** no servidor.'
    )
    .addFields(
      { name: 'Código', value: `\`${code}\``, inline: true },
      { name: 'Expira', value: expiresText, inline: true }
    )
    .setFooter({ text: 'Se você não pediu esse login, ignore esta mensagem.' })
    .setTimestamp();
}

function buildDashboardAccessResultDm({ guildName, allowed, reason }) {
  return new EmbedBuilder()
    .setColor(allowed ? colors.default : colors.red)
    .setTitle(allowed ? 'Acesso da dashboard liberado' : 'Acesso da dashboard negado')
    .setDescription(
      allowed
        ? `Seu acesso à dashboard de **${guildName}** foi liberado com sucesso.`
        : `Não consegui liberar seu acesso à dashboard de **${guildName}**.\n\nMotivo: ${reason || 'código inválido.'}`
    )
    .setTimestamp();
}

function buildWelcomeDm(member, verifyChannelId) {
  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('👋 Bem-vindo(a)!')
    .setDescription(
      `Olá, **${member.user.username}**. Seja bem-vindo(a) ao servidor **${member.guild.name}**.\n\n` +
        'Antes de acessar todos os canais, complete sua verificação e leia as regras.'
    )
    .addFields(
      { name: '1. Verifique seu acesso', value: verifyChannelId ? `Acesse <#${verifyChannelId}> e clique em **Verificar**.` : 'Acesse o canal de verificação.' },
      { name: '2. Veja os planos', value: 'Depois da verificação, consulte os planos disponíveis no servidor.' },
      { name: '3. Suporte', value: 'Se precisar de ajuda, abra um ticket e descreva sua necessidade.' }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Equipe de atendimento' })
    .setTimestamp();
}

function buildDeliveryFeedbackDm(guildName) {
  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('🚀 Seu bot está pronto')
    .setDescription(
      `Seu projeto em **${guildName}** foi marcado como pronto.\n\n` +
        'Teste o bot com calma e envie seu feedback no canal do projeto.'
    )
    .addFields(
      { name: 'Feedback', value: 'Diga se está tudo certo ou se precisa de algum ajuste.' },
      { name: 'Suporte', value: 'Se seu plano inclui suporte, a equipe vai acompanhar pelo canal criado para você.' }
    )
    .setTimestamp();
}

function buildHostingBillingPanel({ guildName, projectName, dueAt, channelId }) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.orange)
        .setTitle('💳 Cobrança de hospedagem')
        .setDescription(
          `Seu projeto **${projectName || 'seu projeto'}** em **${guildName}** está com cobrança de hospedagem pendente.\n\n` +
            'Se ainda não pagou, clique em **Não paguei** para receber as instruções.'
        )
        .addFields(
          { name: 'Vencimento', value: dueAt || 'não informado', inline: true },
          { name: 'Canal do projeto', value: channelId ? `<#${channelId}>` : 'não informado', inline: true }
        )
        .setFooter({ text: 'O acesso pode ser suspenso após o prazo de tolerância.' })
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hosting_unpaid:${channelId}`).setLabel('Não paguei').setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function buildHostingPaymentInstructionDm({ guildName, projectName }) {
  return new EmbedBuilder()
    .setColor(colors.orange)
    .setTitle('⚠️ Pagamento em análise')
    .setDescription(
      `Recebemos sua confirmação de pagamento em **${guildName}** para o projeto **${projectName || 'seu projeto'}**.\n\n` +
        'Agora envie o comprovante no ticket para a equipe liberar o próximo passo.'
    )
    .setFooter({ text: 'Sistema automático de cobrança' })
    .setTimestamp();
}

function buildHostingAccessCreatedDm({ guildName, projectName, accessKey }) {
  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('🔑 Chave de acesso criada')
    .setDescription(
      `Sua chave de acesso para **${guildName}** foi criada para o projeto **${projectName || 'seu projeto'}**.\n\n` +
        'Envie o comprovante de pagamento no ticket com a chave visível. Depois da aprovação, você receberá o acesso ao canal do projeto.'
    )
    .addFields(
      { name: 'Chave de acesso', value: `\`${accessKey}\``, inline: false },
      { name: 'Orientação', value: 'Não compartilhe essa chave com outras pessoas.' }
    )
    .setFooter({ text: 'A senha foi definida por você na etapa anterior e fica registrada em formato seguro no sistema.' })
    .setTimestamp();
}

function buildHostingOverdueDm({ guildName, projectName }) {
  return new EmbedBuilder()
    .setColor(colors.red)
    .setTitle('❌ Acesso interrompido por falta de pagamento')
    .setDescription(
      `O pagamento da hospedagem do projeto **${projectName || 'seu projeto'}** em **${guildName}** não foi regularizado dentro do prazo.\n\n` +
        'Seu acesso foi interrompido. Abra um ticket para informar a situação.'
    )
    .addFields({ name: 'Ação necessária', value: 'Regularizar a hospedagem para tentar reativar o acesso.' })
    .setTimestamp();
}

function buildAccessApprovalDm({ guildName, projectName, accessKey, accessPassword, channelId }) {
  const fields = [
    { name: 'Projeto', value: projectName || 'não informado', inline: true },
    { name: 'Chave de acesso', value: `\`${accessKey}\``, inline: true }
  ];

  if (accessPassword) {
    fields.push({ name: 'Senha', value: `\`${accessPassword}\``, inline: true });
  }

  return {
    embed: new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('🔐 Acesso liberado')
      .setDescription(
        `Seu comprovante foi aprovado em **${guildName}**.\n\n` +
          'Para acessar seu canal do projeto, clique no botão abaixo e informe a chave de acesso e a senha definida na etapa de criação.'
      )
      .addFields(fields)
      .setFooter({ text: 'Mantenha essas informações em sigilo e use apenas para liberar seu canal.' })
      .setTimestamp(),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`access_unlock:${channelId}`)
          .setLabel('Liberar acesso')
          .setStyle(ButtonStyle.Success)
      )
    ]
  };
}

function buildAccessUnlockedDm({ guildName, projectName, channelName }) {
  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('✅ Acesso do canal liberado')
    .setDescription(
      `Seu acesso ao projeto **${projectName || 'seu projeto'}** foi liberado em **${guildName}**.\n\n` +
        `Abra o canal ${channelName ? `**${channelName}**` : 'do seu projeto'} e acompanhe as mensagens normalmente.`
    )
    .addFields(
      { name: 'Orientação', value: 'Se a página não atualizar, feche e abra o Discord novamente.' },
      { name: 'Suporte', value: 'Se tiver qualquer problema, responda esta mensagem ou abra um ticket.' }
    )
    .setFooter({ text: 'Mensagem automática do sistema de acesso.' })
    .setTimestamp();
}

module.exports = {
  buildHostingBillingPanel,
  buildHostingPaymentInstructionDm,
  buildHostingAccessCreatedDm,
  buildHostingOverdueDm,
  buildAccessApprovalDm,
  buildAccessUnlockedDm,
  buildDashboardAccessResultDm,
  buildDashboardVerificationCodeDm,
  buildDeliveryFeedbackDm,
  buildVerificationSuccessDm,
  buildWelcomeDm,
  sendDmPanel
};
