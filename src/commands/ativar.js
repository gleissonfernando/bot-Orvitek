const {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

function buildSourceGuildModal() {
  return new ModalBuilder()
    .setCustomId('clone_source_modal')
    .setTitle('Ativar clonagem')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('source_guild_id')
          .setLabel('ID do servidor de origem')
          .setPlaceholder('Cole aqui o ID do servidor modelo')
          .setStyle(TextInputStyle.Short)
          .setMinLength(17)
          .setMaxLength(20)
          .setRequired(true)
      )
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Inicia a clonagem segura de um servidor modelo para um destino.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Use este comando dentro de um servidor.', ephemeral: true });
      return;
    }

    await interaction.showModal(buildSourceGuildModal());
  }
};
