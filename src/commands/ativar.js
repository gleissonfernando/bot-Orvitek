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
        .setName('servidor_origem')
        .setDescription('ID do servidor Discord que sera usado como origem/modelo.')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20)
    )
    .addStringOption((option) =>
      option
        .setName('servidor_destino')
        .setDescription('ID do servidor Discord onde cargos, canais e paineis serao criados.')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20)
    )
    .addStringOption((option) =>
      option
        .setName('id_discord')
        .setDescription('ID Discord do dono/responsavel que recebera o cargo Dono no destino.')
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

    const sourceGuildId = interaction.options.getString('servidor_origem', true).trim();
    const targetGuildId = interaction.options.getString('servidor_destino', true).trim();
    const ownerDiscordId = interaction.options.getString('id_discord', true).trim();

    if (![sourceGuildId, targetGuildId, ownerDiscordId].every(isDiscordId)) {
      await interaction.reply(privateReply('Informe IDs Discord validos, apenas numeros, com 17 a 20 digitos.'));
      return;
    }

    const sourceGuild = await interaction.client.guilds.fetch(sourceGuildId).catch(() => null);
    if (!sourceGuild) {
      await interaction.reply(privateReply('Nao encontrei o servidor de origem. O bot precisa estar nesse servidor para usar esse ID.'));
      return;
    }

    const targetGuild = await interaction.client.guilds.fetch(targetGuildId).catch(() => null);
    if (!targetGuild) {
      await interaction.reply(privateReply('Nao encontrei o servidor de destino. O bot precisa estar nesse servidor para criar cargos e canais.'));
      return;
    }

    const executorInTarget = await targetGuild.members.fetch(interaction.user.id).catch(() => null);
    if (!executorInTarget?.permissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply(privateReply('Voce precisa ser administrador no servidor de destino para ativar o sistema nele.'));
      return;
    }

    const ownerMember = await targetGuild.members.fetch(ownerDiscordId).catch(() => null);
    if (!ownerMember) {
      await interaction.reply(privateReply('O ID Discord do dono/responsavel precisa pertencer a um membro do servidor de destino.'));
      return;
    }

    await interaction.reply(privateReply({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.gold)
          .setTitle('Confirmar configuracao do servidor')
          .setDescription(
            'O SetupBot vai criar cargos, categorias, canais e paineis automaticamente.\n\n' +
              `Origem/modelo: **${sourceGuild.name}** (\`${sourceGuild.id}\`)\n` +
              `Destino: **${targetGuild.name}** (\`${targetGuild.id}\`)\n` +
              `Dono/responsavel no destino: ${ownerMember} (\`${ownerDiscordId}\`)\n\n` +
              'Nenhum canal ou cargo existente sera apagado. Se algum nome ja existir, ele sera pulado e informado no relatorio.'
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup_confirm:${interaction.user.id}:${ownerDiscordId}:${sourceGuild.id}:${targetGuild.id}`).setLabel('Ativar SetupBot').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`setup_cancel:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    }));
  }
};
