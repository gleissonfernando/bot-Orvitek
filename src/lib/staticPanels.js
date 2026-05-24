const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { colors } = require('../config/setup');

function buildTicketPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.blue)
        .setTitle('Central de Suporte')
        .setDescription(
          'Precisa de ajuda? Abra um ticket e nossa equipe irá atendê-lo em breve.\n\n' +
            'Horario de atendimento: Seg-Sex, 9h-18h\nDescreva seu problema com detalhes para um atendimento mais rapido.'
        )
    ],
    components: [
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
    ]
  };
}

function buildRenewPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.orange)
        .setTitle('Renovação de Plano')
        .setDescription('Seu plano expirou ou está prestes a vencer. Renove agora para não perder o acesso!\n\nClientes com plano expirado têm acesso limitado ao servidor.')
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('renew_now').setLabel('Renovar Agora').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('renew_check').setLabel('Já renovei, verificar acesso').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
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
  buildTicketPanelPayload
};
