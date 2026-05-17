const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');

function buildHowItWorksEmbeds() {
  return [
    new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle('Como funciona nosso sistema')
      .setDescription(
        'Entenda em poucos passos como adquirir, ativar e usar nosso produto. É simples, rápido e totalmente automatizado.\n\n' +
          '**passo 1** Escolhe o plano › **passo 2** Confirma a contratação › **passo 3** Acesso liberado › **passo 4** Usa o produto › **passo 5** Renova quando quiser\n\n' +
          '⚡ Ativação em até 5 minutos após a confirmação'
      )
      .addFields(
        { name: 'Passo a passo completo', value: '\u200b' },
        {
          name: '1. Leia as regras e aceite',
          value: 'No canal #regras, leia as regras para entender como a comunidade funciona.'
        },
        {
          name: '2. Escolha seu plano',
          value: 'Vá até #planos-e-precos e compare os planos disponíveis. Cada plano tem benefícios e tempo de acesso diferentes.'
        },
        {
          name: '3. Confirme a contratação',
          value: 'Clique em comprar no plano desejado e siga as instruções do bot para continuar o atendimento.'
        },
        {
          name: '4. Confirmação automática',
          value: 'Após a confirmação, o bot libera seu acesso automaticamente e você recebe uma DM com suas credenciais.'
        },
        {
          name: '5. Acesse a área do cliente',
          value: 'Com o cargo de Cliente Ativo, você terá acesso a #area-do-cliente, #meus-acessos e todos os canais exclusivos.'
        },
        {
          name: '6. Precisa de ajuda? Abra um ticket',
          value: 'A qualquer momento, vá em #abrir-ticket. Nossa equipe responde em até 24h nos dias úteis.'
        },
        { name: 'O que cada plano inclui', value: 'Comparativo rápido' },
        {
          name: 'Plano Básico mensal',
          value: 'Acesso ao produto principal, suporte via ticket e atualizações incluídas durante a vigência.'
        },
        {
          name: 'Plano Profissional mensal',
          value: 'Tudo do básico + cargo VIP, canal exclusivo, prioridade no suporte e acesso antecipado a novidades.'
        },
        {
          name: 'Plano Vitalício pagamento único',
          value: 'Acesso permanente, todos os benefícios, nunca precisa renovar e cargo VIP vitalício.'
        },
        {
          name: 'Todos os planos incluem',
          value: '✅ Atualizações automáticas\n✅ Suporte dedicado\n✅ Acesso imediato'
        },
        {
          name: 'Política de reembolso',
          value:
            '✅ Reembolso disponível em até 7 dias após a compra caso o produto não funcione conforme descrito.\n\n' +
            'Chargebacks sem contato prévio resultam em banimento permanente. Sempre fale conosco antes.'
        }
      )
      .setFooter({ text: 'Para comprar, acesse o canal de planos ou fale com o suporte.' })
  ];
}

module.exports = {
  buildHowItWorksEmbeds
};
