const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  buildSystemPanelButtons,
  buildSystemPanelEmbed,
  suppressPanelRestore
} = require('../lib/interactions');
const { buildNoticePayload } = require('../lib/planSelectionPanel');
const { replacePanelMessage } = require('../lib/panelUtils');
const { updateSystemSettings } = require('../lib/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel de controle do sistema.')
    .addChannelOption((option) =>
      option.setName('canal').setDescription('Canal onde o painel de controle sera enviado.').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('canal') || interaction.channel;
    if (!targetChannel?.isTextBased()) {
      await interaction.reply(buildNoticePayload('Selecione um canal de texto ou use o comando em um canal de texto.', 0xff4757));
      return;
    }

    updateSystemSettings(interaction.guild.id, {
      ui: {
        systemPanelChannelId: targetChannel.id,
        systemPanelUpdatedBy: interaction.user.id,
        systemPanelUpdatedAt: new Date().toISOString()
      }
    });

    suppressPanelRestore(targetChannel.id, 15000);
    await replacePanelMessage(targetChannel, {
      embeds: [buildSystemPanelEmbed(interaction.guild)],
      components: buildSystemPanelButtons()
    }, { deleteAll: true });

    await interaction.reply(buildNoticePayload(`Painel de controle enviado em ${targetChannel}.`));
  }
};
