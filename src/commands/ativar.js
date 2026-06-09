const {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

function buildSourceGuildModal(sourceGuildId = '') {
  const input = new TextInputBuilder()
    .setCustomId('source_guild_id')
    .setLabel('ID do servidor de origem')
    .setPlaceholder('Cole aqui o ID do servidor modelo')
    .setStyle(TextInputStyle.Short)
    .setMinLength(17)
    .setMaxLength(20)
    .setRequired(true);

  if (sourceGuildId) {
    input.setValue(sourceGuildId);
  }

  return new ModalBuilder()
    .setCustomId('clone_source_modal')
    .setTitle('Ativar clonagem')
    .addComponents(
      new ActionRowBuilder().addComponents(input)
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Inicia a clonagem segura de um servidor modelo para um destino.')
    .addStringOption((option) =>
      option
        .setName('servidor_origem')
        .setDescription('Opcional: ID do servidor modelo para ja abrir preenchido.')
        .setRequired(false)
        .setMinLength(17)
        .setMaxLength(20)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Use este comando dentro de um servidor.', ephemeral: true });
      return;
    }

    const sourceGuildId = interaction.options.getString('servidor_origem', false)?.trim() || '';
    await interaction.showModal(buildSourceGuildModal(sourceGuildId));
  }
};
