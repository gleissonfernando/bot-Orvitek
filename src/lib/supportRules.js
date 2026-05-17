const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');

function buildSupportRulesEmbeds() {
  return [
    new EmbedBuilder()
      .setColor(colors.blue)
      .setTitle('Regras do Suporte')
      .setDescription(
        'Leia com atenção antes de abrir um ticket. O descumprimento das regras pode resultar em fechamento do ticket ou suspensão do acesso ao suporte.'
      )
      .addFields(
        {
          name: '1. Abra apenas 1 ticket por vez',
          value: 'Não é permitido ter mais de um ticket aberto simultaneamente. Aguarde a resolução do atual antes de abrir outro.'
        },
        {
          name: '2. Descreva o problema com clareza',
          value: 'Explique detalhadamente o problema: o que aconteceu, quando aconteceu e o que você já tentou. Tickets vagos como "não funciona" atrasam o atendimento.'
        },
        {
          name: '3. Não mencione (@) a equipe sem necessidade',
          value: 'Não marque membros da equipe fora do ticket. Nossa equipe verifica os tickets regularmente. Mencionar repetidamente resulta em aviso.'
        },
        {
          name: '4. Respeite a equipe de suporte',
          value: 'Grosserias, xingamentos ou intimidação resultam em fechamento imediato do ticket e suspensão do suporte.'
        },
        {
          name: '5. Não divulgue o conteúdo do ticket',
          value: 'O ticket é privado. Compartilhar prints, conversas ou informações do atendimento publicamente sem autorização pode resultar em suspensão.'
        },
        {
          name: '6. Não abuse do sistema de tickets',
          value: 'Abrir tickets para fins que não sejam suporte técnico, dúvidas ou pagamentos é considerado abuso e pode resultar em bloqueio.'
        },
        {
          name: '7. Ticket inativo é fechado automaticamente',
          value: 'Se você não responder em até 24 horas após uma mensagem da equipe, o ticket será fechado automaticamente.'
        },
        {
          name: '8. Chargeback ou disputa indevida',
          value: 'Realizar chargeback ou disputa de pagamento sem contato prévio com o suporte resulta em banimento imediato e permanente do servidor.'
        },
        { name: 'Segunda a Sexta', value: '09h - 18h', inline: true },
        { name: 'Sábado', value: '10h - 14h', inline: true },
        { name: '⚠️ Fora do horário', value: 'Tickets são registrados e respondidos no próximo período.' },
        { name: '1ª vez', value: 'Aviso', inline: true },
        { name: '2ª vez', value: 'Ticket fechado', inline: true },
        { name: '3ª vez', value: 'Bloqueio 7 dias', inline: true },
        { name: 'Grave', value: 'Ban permanente', inline: true }
      )
      .setFooter({ text: 'Ao abrir um ticket, você concorda com estas regras.' })
  ];
}

module.exports = {
  buildSupportRulesEmbeds
};
