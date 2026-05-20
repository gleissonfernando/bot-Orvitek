const nodemailer = require('nodemailer');
const { Client, EmbedBuilder, GatewayIntentBits } = require('discord.js');

let discordClient = null;
let discordLoginPromise = null;

function formatarMoeda(centavos) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(centavos || 0) / 100);
}

function formatarData(data) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(new Date(data || Date.now()));
}

async function enviarEmailGmail(destino, pedido) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('GMAIL_USER e GMAIL_APP_PASSWORD precisam estar configurados.');
  }

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    }
  });

  await transport.sendMail({
    from: `"Orvitek" <${user}>`,
    to: destino,
    subject: `Pagamento confirmado - ${pedido.descricao}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
        <h1 style="color: #16a34a;">Pagamento Confirmado ✅</h1>
        <p>Olá, <strong>${pedido.cliente_nome || 'cliente'}</strong>.</p>
        <p>Recebemos o pagamento da sua compra na <strong>Orvitek</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Produto</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>${pedido.descricao}</strong></td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Valor pago</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>${formatarMoeda(pedido.valor)}</strong></td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Data e hora</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${formatarData(pedido.pago_em)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">ID do pedido</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${pedido.reference_id}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">End-to-end ID PIX</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${pedido.end_to_end_id || 'não informado'}</td></tr>
        </table>
        <p style="margin-top: 24px;">Obrigado por comprar com a Orvitek.</p>
      </div>
    `
  });
}

async function getDiscordClient() {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN precisa estar configurado.');
  }

  if (discordClient?.isReady()) {
    return discordClient;
  }

  if (!discordClient) {
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  }

  if (!discordLoginPromise) {
    discordLoginPromise = discordClient.login(token);
  }

  await discordLoginPromise;
  return discordClient;
}

async function enviarDmDiscord(destino, pedido) {
  const client = await getDiscordClient();
  const user = await client.users.fetch(destino);

  await user.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle('✅ Pagamento Confirmado!')
        .setDescription('Comprovante de compra da Orvitek.')
        .addFields(
          { name: 'Produto', value: pedido.descricao || 'Produto Orvitek', inline: true },
          { name: 'Valor', value: formatarMoeda(pedido.valor), inline: true },
          { name: 'Data', value: formatarData(pedido.pago_em), inline: true },
          { name: 'ID do pedido', value: `\`${pedido.reference_id}\``, inline: false },
          { name: 'End-to-end ID PIX', value: pedido.end_to_end_id ? `\`${pedido.end_to_end_id}\`` : 'não informado', inline: false }
        )
        .setFooter({ text: 'Orvitek' })
        .setTimestamp()
    ]
  });
}

async function enviarComprovante({ canal, destino, pedido }) {
  try {
    if (canal === 'gmail') {
      await enviarEmailGmail(destino, pedido);
      console.log(' Comprovante enviado por Gmail');
      return true;
    }

    if (canal === 'discord') {
      await enviarDmDiscord(destino, pedido);
      console.log(' Comprovante enviado por Discord DM');
      return true;
    }

    console.warn(`Canal de comprovante inválido: ${canal || 'vazio'}`);
    return false;
  } catch (error) {
    console.error(`Erro ao enviar comprovante por ${canal}:`, error.message);
    return false;
  }
}

module.exports = {
  enviarComprovante,
  enviarDmDiscord,
  enviarEmailGmail
};
