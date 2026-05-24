const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');
const { buildWelcomeDm } = require('./dmPanels');

function buildWelcomeDmEmbed(member, verifyChannelId) {
  return buildWelcomeDm(member, verifyChannelId);
}

function buildWelcomeChannelEmbed(member, verifyChannelId) {
  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Novo membro na comunidade')
    .setDescription(
      `${member} entrou no servidor!\n\n` +
        'Seja bem-vindo. Faça a verificação, leia as regras e use os tickets somente quando precisar de atendimento.'
    )
    .addFields(
      { name: 'Usuário', value: member.user.tag, inline: true },
      { name: 'Primeiro passo', value: verifyChannelId ? `<#${verifyChannelId}>` : 'Verificação', inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

module.exports = {
  buildWelcomeChannelEmbed,
  buildWelcomeDmEmbed
};
