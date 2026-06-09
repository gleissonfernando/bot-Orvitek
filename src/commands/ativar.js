const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../config/setup');
const { privateReply } = require('../lib/replies');

function isDiscordId(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Configura o servidor automaticamente com cargos, canais, paineis e sistemas.')
    .addStringOption((option) =>
      option
        .setName('id_discord')
        .setDescription('ID Discord do dono ou responsavel deste servidor.')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20)
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Use este comando dentro de um servidor.'));
      return;
    }

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply(privateReply('Apenas administradores podem ativar o SetupBot.'));
      return;
    }

    const ownerDiscordId = interaction.options.getString('id_discord', true).trim();
    if (!isDiscordId(ownerDiscordId)) {
      await interaction.reply(privateReply('Informe um ID Discord valido, apenas numeros, com 17 a 20 digitos.'));
      return;
    }

    const ownerMember = await interaction.guild.members.fetch(ownerDiscordId).catch(() => null);
    if (!ownerMember) {
      await interaction.reply(privateReply('O ID Discord informado precisa pertencer a um membro deste servidor.'));
      return;
    }

    await interaction.reply(privateReply({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.gold)
          .setTitle('Confirmar configuracao do servidor')
          .setDescription(
            'O SetupBot vai criar cargos, categorias, canais e paineis automaticamente.\n\n' +
              `Servidor: \`${interaction.guild.id}\`\n` +
              `Dono/responsavel: ${ownerMember} (\`${ownerDiscordId}\`)\n\n` +
              'Nenhum canal ou cargo existente sera apagado. Se algum nome ja existir, ele sera pulado e informado no relatorio.'
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup_confirm:${interaction.user.id}:${ownerDiscordId}`).setLabel('Ativar SetupBot').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`setup_cancel:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    }));
  }
};
