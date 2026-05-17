const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/setup');

function buildServerRulesEmbeds() {
  return [
    new EmbedBuilder()
      .setColor(colors.default)
      .setTitle('Regras do Servidor')
      .setDescription('Leia todas as regras antes de interagir na comunidade. O descumprimento pode resultar em aviso, restrição ou banimento.')
      .addFields(
        { name: 'Conduta e Comunicação', value: '\u200b' },
        {
          name: '1. Respeito acima de tudo',
          value: 'Trate todos com respeito e educação. Xingamentos, humilhações, bullying, preconceito ou ataques pessoais não serão tolerados.'
        },
        {
          name: '2. Sem spam ou flood',
          value: 'Proibido enviar mensagens repetidas, floods de texto, emojis em excesso ou menções desnecessárias. Use cada canal para seu propósito.'
        },
        {
          name: '3. Português em canais gerais',
          value: 'A comunicação nos canais públicos deve ser em português. Outros idiomas são permitidos apenas em DM com a equipe ou em canais específicos.'
        },
        {
          name: '4. Sem autopromoção',
          value: 'É proibido divulgar outros servidores, produtos, serviços, links de afiliado ou qualquer autopromoção sem autorização prévia.'
        },
        {
          name: '5. Use os canais corretamente',
          value: 'Cada canal tem um propósito definido no nome. Conteúdo fora do contexto pode resultar em aviso.'
        },
        { name: 'Segurança e Privacidade', value: '\u200b' },
        {
          name: '6. Sem links suspeitos',
          value: 'É proibido enviar links maliciosos, phishing, IP grabbers ou qualquer link que comprometa a segurança dos membros.'
        },
        {
          name: '7. Não compartilhe dados pessoais',
          value: 'Não divulgue dados pessoais seus ou de terceiros: CPF, endereço, cartão, senha ou qualquer informação sensível.'
        },
        {
          name: '8. Contas alternativas são proibidas',
          value: 'Cada pessoa pode ter apenas uma conta ativa. Usar contas alternativas para driblar punições resulta em banimento permanente.'
        },
        {
          name: '9. Não tente hackear ou explorar o servidor',
          value: 'Explorar bugs do bot, cargos ou permissões sem autorização resulta em banimento imediato.'
        },
        { name: 'Conteúdo Proibido', value: '\u200b' },
        {
          name: '10. Sem conteúdo NSFW',
          value: 'É absolutamente proibido enviar conteúdo adulto, sexual ou violento em qualquer canal. Punição: banimento imediato.'
        },
        {
          name: '11. Sem discurso de ódio',
          value: 'Comentários racistas, homofóbicos, xenofóbicos, misóginos ou discriminatórios resultam em banimento permanente imediato.'
        },
        {
          name: '12. Sem pirataria ou conteúdo ilegal',
          value: 'Proibido compartilhar softwares crackeados, conteúdo protegido por direitos autorais, métodos ilegais ou material que infrinja a lei.'
        },
        {
          name: '13. Sem golpes ou fraudes',
          value: 'Tentativas de golpe em membros, por DM ou canais públicos, resultam em banimento permanente e podem ser reportadas.'
        }
      )
      .setFooter({ text: 'Ao permanecer no servidor, você concorda com estas regras.' })
  ];
}

module.exports = {
  buildServerRulesEmbeds
};
