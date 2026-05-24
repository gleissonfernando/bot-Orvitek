const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function buildVerificationPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('✅ Verificação de Membro')
        .setDescription(
          'Bem-vindo ao servidor!\n\n' +
            'Para acessar todos os canais e recursos, você precisa **completar a verificação**.\n\n' +
            'Clique no botão abaixo para confirmar que leu e aceita as regras do servidor.'
        )
        .setFooter({ text: 'Ao verificar, você confirma que aceita as regras.' })
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_member')
          .setLabel('✅ Verificar')
          .setStyle(ButtonStyle.Success)
      )
    ]
  };
}

module.exports = {
  buildVerificationPanel
};
