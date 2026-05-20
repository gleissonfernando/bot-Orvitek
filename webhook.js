const { atualizarPedido, buscarPedido } = require('./database');
const { validarAssinaturaWebhook } = require('./pagbank');
const { enviarComprovante } = require('./comprovante');

const statusMap = {
  WAITING: 'AGUARDANDO',
  IN_ANALYSIS: 'AGUARDANDO',
  PAID: 'PAGO',
  DECLINED: 'RECUSADO',
  CANCELED: 'CANCELADO',
  CANCELLED: 'CANCELADO'
};

function primeiroCharge(payload) {
  return Array.isArray(payload?.charges) ? payload.charges[0] || null : null;
}

function statusDoPayload(payload) {
  const charge = primeiroCharge(payload);
  return charge?.status || payload?.status || 'WAITING';
}

function statusInterno(statusPagBank) {
  return statusMap[statusPagBank] || 'AGUARDANDO';
}

function emojiStatus(statusPagBank) {
  if (statusPagBank === 'PAID') return '✅ PAGO';
  if (statusPagBank === 'DECLINED') return '❌ RECUSADO';
  if (statusPagBank === 'CANCELED' || statusPagBank === 'CANCELLED') return ' CANCELADO';
  return '⏳ AGUARDANDO';
}

function endToEndId(payload) {
  const charge = primeiroCharge(payload);
  return charge?.payment_method?.pix?.end_to_end_id || null;
}

function pagoEm(payload) {
  const charge = primeiroCharge(payload);
  return charge?.paid_at || null;
}

async function processarWebhookPagBank(req) {
  const rawBody = req.rawBody || '';
  const assinatura = req.headers['x-authenticity-token'];

  if (!validarAssinaturaWebhook(rawBody, assinatura)) {
    console.warn('Webhook PagBank ignorado: assinatura inválida.');
    return { ok: true, ignored: true };
  }

  const payload = req.body || {};
  const statusPagBank = statusDoPayload(payload);
  const novoStatus = statusInterno(statusPagBank);
  const id = payload.id;
  const referenceId = payload.reference_id;
  const pedido = buscarPedido(id) || buscarPedido(referenceId);

  console.log(`${emojiStatus(statusPagBank)} Webhook PagBank`, {
    id,
    reference_id: referenceId,
    status: statusPagBank
  });

  if (!pedido) {
    console.warn(`Pedido não encontrado para webhook: ${id || referenceId || 'sem id'}`);
    return { ok: true, notFound: true };
  }

  let atualizado = atualizarPedido(pedido.id, {
    status: novoStatus,
    pagbank_status: statusPagBank,
    pago_em: statusPagBank === 'PAID' ? pagoEm(payload) || new Date().toISOString() : pedido.pago_em,
    end_to_end_id: endToEndId(payload) || pedido.end_to_end_id
  });

  if (statusPagBank === 'PAID' && !atualizado.comprovante_enviado) {
    console.log('✅ PAGO - executando lógica de negócio para pedido', atualizado.reference_id);
    const enviado = await enviarComprovante({
      canal: atualizado.comprovante_canal,
      destino: atualizado.comprovante_destino,
      pedido: atualizado
    });

    if (enviado) {
      atualizado = atualizarPedido(atualizado.id, { comprovante_enviado: 1 });
    }
  }

  return { ok: true, pedido: atualizado };
}

module.exports = {
  processarWebhookPagBank,
  statusInterno
};
