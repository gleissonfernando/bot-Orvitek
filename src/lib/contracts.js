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

function planInfo(type) {
  if (type === 'plan_pro') {
    return { name: 'Premium', total: 250 };
  }

  if (type === 'plan_lifetime') {
    return { name: 'Vitalício', total: 250 };
  }

  return { name: 'Básico', total: 50 };
}

function resolvePlan(contract) {
  const pricing = getPlanPricing(contract.planType, contract.settings || {}, contract.couponCode || null);
  const plan = planInfo(contract.planType);
  const total = Number.isFinite(contract.finalPrice) ? Number(contract.finalPrice) : Number.isFinite(pricing.final) ? pricing.final : plan.total;
  const entry = total / 2;
  return { ...plan, total, entry, pricing };
}

function buildContractIntroEmbed(ticket) {
  const plan = planInfo(ticket.type);
  const entry = plan.total / 2;

  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle('Contrato Online — Orvitel-bot')
    .setDescription(
      'Antes de iniciar pagamento, fila ou produção, o cliente precisa preencher e aceitar o contrato digital.\n\n' +
        'Ao assinar, o contrato em PDF segue para o privado do cliente e o canal fica pronto para a criação da chave de acesso.'
    )
    .addFields(
      { name: 'Plano selecionado', value: plan.name, inline: true },
      { name: 'Valor total', value: money(plan.total), inline: true },
      { name: 'Entrada 50%', value: money(entry), inline: true },
      { name: 'Regra importante', value: 'Após início do desenvolvimento, a entrada de 50% não é reembolsável.' },
      { name: 'Entrega', value: 'A produção entra na fila após aprovação da entrada. Prazo médio: até 5 dias.' }
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
      { name: 'Entrada para fila', value: money(plan.entry), inline: true },
      {
        name: 'Desconto aplicado',
        value: contract.couponCode ? `${contract.couponCode} (-${contract.couponPercent || 0}%)` : 'Sem cupom',
        inline: true
      },
      { name: 'Próximo passo', value: 'Criar a chave de acesso, enviar o comprovante e aguardar aprovação.', inline: true }
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
    .setTitle('Contrato Orvitel-bot')
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
          .setLabel('CPF')
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
          .setLabel('WhatsApp e forma de pagamento')
          .setPlaceholder('Ex: (11) 99999-9999 | Pix')
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
  const entry = plan.entry;
  const remaining = plan.total - entry;
  const discountLine = contract.couponCode
    ? `Cupom aplicado: ${contract.couponCode} (-${contract.couponPercent || 0}%)\nValor com desconto: ${money(plan.total)}\n`
    : '';

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DIGITAIS — ORVITEL-BOT

CONTRATADA:
Orvitel-bot

CONTRATANTE:
Nome: ${contract.fullName}
CPF: ${contract.cpf}
E-mail: ${contract.email}
Telefone/Forma de pagamento: ${contract.phoneAndPayment}
Projeto/Bot: ${contract.projectName}
Discord: ${contract.userTag} (${contract.userId})

1. OBJETO DO CONTRATO
Este contrato tem como objetivo a prestação de serviço de desenvolvimento, configuração ou personalização de bot para Discord, conforme as funcionalidades combinadas entre a Orvitel-bot e o contratante.

2. VALOR DO SERVIÇO
Plano contratado: ${plan.name}
${discountLine}Valor total: ${money(plan.total)}
Entrada de 50%: ${money(entry)}
Valor restante: ${money(remaining)}

3. INÍCIO DO SERVIÇO
O serviço somente será iniciado após a confirmação do pagamento inicial de 50%.

4. ENTREGA DO SERVIÇO
A Orvitel-bot se compromete a realizar o serviço conforme combinado previamente com o contratante. Alterações extras, novas funções ou mudanças fora do combinado inicial poderão gerar cobrança adicional.

5. DESISTÊNCIA E NÃO REEMBOLSO
Caso o contratante desista do serviço após o início do desenvolvimento, o valor inicial de 50% não será reembolsado. Esse valor será considerado taxa de serviço iniciado, cobrindo tempo técnico, planejamento, configuração, desenvolvimento inicial e reserva de agenda.

6. PAGAMENTO FINAL
Após o bot estar pronto, o contratante deverá realizar o pagamento dos 50% restantes para receber a entrega final, arquivos, acesso ou configuração definitiva do bot.

7. HOSPEDAGEM E MANUTENÇÃO
Quando aplicável, o serviço de hospedagem é cobrado mensalmente e precisa ser regularizado até o dia 08 de cada mês.
Se a hospedagem não for paga, o sistema enviará aviso automático e poderá interromper o acesso ao canal e ao bot.
Após 15 dias do vencimento sem regularização, a chave de acesso pode ser removida e o acesso será perdido.

8. RESPONSABILIDADE DO CONTRATANTE
O contratante deve fornecer corretamente todas as informações necessárias para a execução do serviço, como dados do servidor, permissões, cargos, canais, textos, imagens e demais informações solicitadas.

9. ASSINATURA ELETRÔNICA
O contratante declara que aceita este contrato de forma eletrônica ao clicar em "Aceito e Assino". A assinatura eletrônica representa concordância com todos os termos descritos neste contrato.

10. DISPOSIÇÕES FINAIS
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
    doc.fontSize(12).fillColor('#111111').text('Orvitel-bot', { align: 'center' });
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
      { name: 'Entrada para fila', value: `${money(plan.entry)} (50% do plano com desconto)`, inline: true },
      { name: 'Valor restante', value: money(plan.total - plan.entry), inline: true },
      {
        name: 'Cupom',
        value: contract.couponCode ? `${contract.couponCode} (-${contract.couponPercent || 0}%)` : 'Sem cupom',
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
