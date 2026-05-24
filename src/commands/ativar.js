const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../config/setup');
const { privateReply } = require('../lib/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Configura o servidor automaticamente com cargos, canais, painéis e sistemas.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply(privateReply('Apenas administradores podem ativar o SetupBot.'));
      return;
    }

    await interaction.reply(privateReply({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.gold)
          .setTitle('Confirmar configuração do servidor')
          .setDescription(
            'O SetupBot vai criar cargos, categorias, canais e painéis automaticamente.\n\n' +
              'Nenhum canal ou cargo existente será apagado. Se algum nome já existir, ele será pulado e informado no relatório.'
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup_confirm:${interaction.user.id}`).setLabel('Ativar SetupBot').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`setup_cancel:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    }));
  }
};
