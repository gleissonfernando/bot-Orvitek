const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { colors } = require('../config/setup');
const { getPlanPricing } = require('./plans');

const contractsDir = path.join(process.cwd(), 'data', 'contracts');

function ensureContractsDir() {
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function planInfo(type, settings = {}) {
  const pricing = getPlanPricing(type, settings || {}, null);
  const total = Number.isFinite(pricing.base) ? pricing.base : 0;

  if (type === 'plan_pro') {
    return { name: 'Premium', total };
  }

  if (type === 'plan_lifetime') {
    return { name: 'Vitalício', total };
  }

  if (type === 'plan_fivem_fac') {
    return { name: 'FiveM FAC', total };
  }

  return { name: 'Básico', total };
}

function resolvePlan(contract) {
  const pricing = getPlanPricing(contract.planType, contract.settings || {}, contract.couponCode || null);
  const plan = planInfo(contract.planType, contract.settings || {});
  const total = Number.isFinite(contract.finalPrice) ? Number(contract.finalPrice) : Number.isFinite(pricing.final) ? pricing.final : plan.total;
  const paid = Number.isFinite(contract.paidPrice) ? Number(contract.paidPrice) : total;
  const remaining = Number.isFinite(contract.remainingPrice) ? Number(contract.remainingPrice) : 0;
  return { ...plan, total, paid, remaining, pricing };
}

function buildContractIntroEmbed(ticket, settings = null) {
  const plan = planInfo(ticket.type, settings || {});
  const pricing = getPlanPricing(ticket.type, settings || {}, null);
  const total = Number.isFinite(pricing.final) ? pricing.final : plan.total;

  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Contrato Online — Orvitek-bots')
    .setDescription(
      'Antes de iniciar a fila ou a produção, o cliente precisa preencher e aceitar o contrato digital.\n\n' +
        'Ao assinar, o contrato em PDF segue para o privado do cliente e o canal fica pronto para a criação da chave de acesso.'
    )
    .addFields(
      { name: 'Plano selecionado', value: plan.name, inline: true },
      { name: 'Valor do plano', value: money(total), inline: true },
      { name: 'Pagamento', value: 'Valor integral via Pix PagBank.', inline: true },
      { name: 'Regra importante', value: 'Após início do desenvolvimento, o valor pago não é reembolsável.' },
      { name: 'Entrega', value: 'A produção entra na fila após confirmação do pagamento. Prazo médio: até 5 dias.' }
    )
    .setFooter({ text: 'Clique em Aceito e Assino para preencher os dados do contrato.' });
}

function buildContractSignedFollowupEmbed(contract) {
  const plan = resolvePlan(contract);

  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('✅ Contrato assinado')
    .setDescription(
      'Contrato aprovado. O PDF foi enviado ao privado do cliente e a próxima etapa é criar a chave de acesso.'
    )
    .addFields(
      { name: 'Cliente', value: contract.fullName, inline: true },
      { name: 'Projeto', value: contract.projectName, inline: true },
      { name: 'Plano', value: plan.name, inline: true },
      { name: 'Valor a pagar', value: money(plan.paid), inline: true },
      {
        name: 'Desconto aplicado',
        value: [
          contract.couponCode ? `${contract.couponCode} (-${contract.couponPercent || 0}%)` : null,
          contract.boostDiscountActive ? `Boost do servidor (-${contract.boostDiscountPercent || 5}%)` : null
        ].filter(Boolean).join('\n') || 'Sem desconto adicional',
        inline: true
      },
      { name: 'Próximo passo', value: 'Criar a chave de acesso, pagar pelo Pix PagBank e aguardar confirmação.', inline: true }
    );
}

function buildContractButton() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('contract_start')
        .setLabel('Aceito e Assino')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildContractModal() {
  return new ModalBuilder()
    .setCustomId('contract_submit')
    .setTitle('Contrato Orvitek-bots')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fullName')
          .setLabel('Nome completo')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cpf')
          .setLabel('CPF ou CNPJ')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('email')
          .setLabel('E-mail')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('phoneAndPayment')
          .setLabel('WhatsApp e contato')
          .setPlaceholder('Ex: (11) 99999-9999 | contato alternativo')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('projectName')
          .setLabel('Nome do projeto/bot')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function contractText(contract) {
  const plan = resolvePlan(contract);
  const baseTotal = Number.isFinite(contract.basePrice) ? Number(contract.basePrice) : plan.total;
  const discountLine = contract.couponCode
    ? `Cupom aplicado: ${contract.couponCode} (-${contract.couponPercent || 0}%)\n`
    : '';
  const boostLine = contract.boostDiscountActive
    ? `Desconto por boost ativo no servidor: ${contract.boostDiscountPercent || 5}%\n`
    : '';

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DIGITAIS — ORVITEK-BOTS

CONTRATADA:
Orvitek-bots

CONTRATANTE:
Nome: ${contract.fullName}
CPF: ${contract.cpf}
E-mail: ${contract.email}
Telefone/Contato: ${contract.phoneAndPayment}
Projeto/Bot: ${contract.projectName}
Discord: ${contract.userTag} (${contract.userId})

1. OBJETO DO CONTRATO
Este contrato tem como objetivo a prestação de serviço de desenvolvimento, configuração ou personalização de bot para Discord, conforme as funcionalidades combinadas entre a Orvitek-bots e o contratante.

2. VALOR DO SERVIÇO
Plano contratado: ${plan.name}
Valor base: ${money(baseTotal)}
${discountLine}${boostLine}Valor final do contrato: ${money(plan.total)}
Valor pago via Pix PagBank: ${money(plan.paid)}
Valor restante: ${money(plan.remaining)}

3. INÍCIO DO SERVIÇO
O serviço somente será iniciado após a confirmação do pagamento.

4. ENTREGA DO SERVIÇO
A Orvitek-bots se compromete a realizar o serviço conforme combinado previamente com o contratante. Alterações extras, novas funções ou mudanças fora do combinado inicial poderão gerar cobrança adicional.

5. DESISTÊNCIA E NÃO REEMBOLSO
Caso o contratante desista do serviço após o início do desenvolvimento, o valor pago não será reembolsado. Esse valor será considerado taxa de serviço iniciado, cobrindo tempo técnico, planejamento, configuração, desenvolvimento inicial e reserva de agenda.

6. COMPROVANTE DE PAGAMENTO
Após a confirmação do pagamento, a Orvitek-bots enviará ao contratante um comprovante digital contendo o produto comprado, valor pago, data e identificação do pedido quando disponível.

7. HOSPEDAGEM E MANUTENÇÃO
Quando aplicável, o serviço de hospedagem é cobrado mensalmente e precisa ser regularizado até o dia 08 de cada mês.
Se a hospedagem não for paga, o sistema enviará aviso automático e poderá interromper o acesso ao canal e ao bot.
Após 15 dias do vencimento sem regularização, a chave de acesso pode ser removida e o acesso será perdido.

8. RESPONSABILIDADE DO CONTRATANTE
O contratante deve fornecer corretamente todas as informações necessárias para a execução do serviço, como dados do servidor, permissões, cargos, canais, textos, imagens e demais informações solicitadas.

9. SIGILO, CONFIDENCIALIDADE E PROTEÇÃO DE INFORMAÇÕES
A Orvitek-bots, na qualidade de contratada, compromete-se a manter sigilo sobre informações, dados, conteúdos, mensagens, arquivos, estruturas, cargos, canais, configurações, estratégias, membros, registros internos e quaisquer demais informações às quais venha a ter acesso no servidor Discord, sistemas, painéis, contas ou ambientes digitais do contratante em razão da execução deste contrato.
A contratada não poderá divulgar, compartilhar, vender, repassar, publicar, copiar, expor ou utilizar essas informações para finalidade diversa da execução do serviço contratado, salvo mediante autorização expressa do contratante, obrigação legal, ordem judicial ou necessidade técnica indispensável para cumprimento do serviço.
O dever de sigilo permanece válido durante a vigência deste contrato e após o encerramento da prestação do serviço, respeitando a legislação brasileira aplicável, incluindo normas de proteção de dados, privacidade, boa-fé contratual e responsabilidade civil. A violação injustificada desta cláusula poderá sujeitar a parte infratora às medidas cabíveis e à reparação de perdas e danos comprovados.

10. ASSINATURA ELETRÔNICA
O contratante declara que aceita este contrato de forma eletrônica ao clicar em "Aceito e Assino". A assinatura eletrônica representa concordância com todos os termos descritos neste contrato.

11. DISPOSIÇÕES FINAIS
Este contrato passa a valer a partir da data de aceite eletrônico pelo contratante.

Data e hora da assinatura: ${contract.signedAt}
IP registrado: ${contract.ip || 'não disponível no Discord'}
Assinatura eletrônica: ACEITO
`;
}

function generateContractPdf(contract) {
  ensureContractsDir();
  const filename = `contrato-${contract.id}-${contract.channelId}.pdf`;
  const filePath = path.join(contractsDir, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(18).fillColor('#d4af37').text('CONTRATO DE PRESTAÇÃO DE SERVIÇOS DIGITAIS', {
      align: 'center'
    });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#111111').text('Orvitek-bots', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('#111111').text(contractText(contract), {
      align: 'left',
      lineGap: 3
    });

    doc.end();

    stream.on('finish', () => {
      resolve(filePath);
    });

    stream.on('error', reject);
  });
}

function buildSignedContractEmbed(contract) {
  const plan = resolvePlan(contract);

  return new EmbedBuilder()
    .setColor(colors.default)
    .setTitle('Contrato assinado')
    .setDescription('O contrato foi aceito eletronicamente. O PDF foi enviado no privado do cliente.')
    .addFields(
      { name: 'Cliente', value: contract.fullName, inline: true },
      { name: 'Projeto', value: contract.projectName, inline: true },
      { name: 'Plano', value: plan.name, inline: true },
      { name: 'Valor a pagar', value: money(plan.paid), inline: true },
      { name: 'Valor restante', value: money(plan.remaining), inline: true },
      {
        name: 'Cupom',
        value: contract.couponCode ? `${contract.couponCode} (-${contract.couponPercent || 0}%)` : 'Sem cupom',
        inline: true
      },
      {
        name: 'Boost',
        value: contract.boostDiscountActive ? `${contract.boostDiscountPercent || 5}% OFF aplicado` : 'Sem boost ativo',
        inline: true
      },
      { name: 'Assinatura', value: contract.signedAt, inline: true }
    );
}

module.exports = {
  buildContractButton,
  buildContractIntroEmbed,
  buildContractModal,
  buildContractSignedFollowupEmbed,
  buildSignedContractEmbed,
  planInfo,
  getPlanPricing,
  generateContractPdf,
  writeContractFile: generateContractPdf
};
