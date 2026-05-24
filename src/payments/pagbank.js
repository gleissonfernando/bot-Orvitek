const crypto = require('node:crypto');

const DEFAULT_PAGBANK_URL = 'https://sandbox.api.pagseguro.com';

function config() {
  return {
    token: process.env.PAGBANK_TOKEN || '',
    baseUrl: (process.env.PAGBANK_URL || DEFAULT_PAGBANK_URL).replace(/\/+$/, ''),
    webhookUrl: process.env.PAGBANK_NOTIFICATION_URL || process.env.WEBHOOK_URL || ''
  };
}

function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function gerarReferenceId() {
  return `ORVITEK-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 64);
}

function dataExpiracaoPix() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function validarCriacaoPagamento({ valor, descricao, cliente }) {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error('Informe valor em centavos. Exemplo: R$ 10,00 = 1000.');
  }

  if (!descricao || String(descricao).trim().length < 3) {
    throw new Error('Informe uma descrição válida.');
  }

  if (!cliente?.nome || !cliente?.email || !cliente?.tax_id) {
    throw new Error('Informe cliente.nome, cliente.email e cliente.tax_id.');
  }
}

function encontrarQrCode(order) {
  const qrCodes = order?.qr_codes || order?.qr_code || [];
  if (Array.isArray(qrCodes)) return qrCodes[0] || null;
  return qrCodes && typeof qrCodes === 'object' ? qrCodes : null;
}

function encontrarLink(qrCode, media) {
  const expectedRel = media === 'image/png' ? 'PNG' : 'BASE64';
  return (qrCode?.links || []).find((link) => (
    String(link.media || '').toLowerCase() === media ||
    String(link.rel || '').toUpperCase().includes(expectedRel)
  ))?.href || null;
}

function gerarImagemQrCode(qrCodeTexto) {
  const texto = String(qrCodeTexto || '').trim();
  if (!texto) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(texto)}`;
}

function textoPixValido(valor) {
  const texto = String(valor || '').trim();
  return /^000201/.test(texto) && /6304[0-9A-F]{4}$/i.test(texto) && texto.length >= 80;
}

function erroEmailCompradorIgualVendedor(mensagem) {
  return String(mensagem || '').toLowerCase().includes('buyer email must not be equals to merchant email');
}

function erroCredencialInvalida(mensagem) {
  const texto = String(mensagem || '').toLowerCase();
  return texto.includes('invalid credential') || texto.includes('review authorization');
}

function formatarErroPagBank(data, statusCode) {
  if (data?.error_messages?.length) {
    const mensagens = data.error_messages.map((erro) => erro.description || erro.message || erro.code).filter(Boolean);
    if (mensagens.some(erroEmailCompradorIgualVendedor)) {
      return 'O e-mail do comprador não pode ser igual ao e-mail da conta vendedora do PagBank.';
    }
    if (mensagens.some(erroCredencialInvalida)) {
      return 'Credencial PagBank inválida. Use token de produção com URL de produção, ou token sandbox com URL sandbox.';
    }
    return mensagens.join('; ');
  }

  if (erroEmailCompradorIgualVendedor(data?.message)) {
    return 'O e-mail do comprador não pode ser igual ao e-mail da conta vendedora do PagBank.';
  }
  if (erroCredencialInvalida(data?.message) || erroCredencialInvalida(data?.raw)) {
    return 'Credencial PagBank inválida. Use token de produção com URL de produção, ou token sandbox com URL sandbox.';
  }
  if (data?.message) return data.message;
  if (data?.raw) return String(data.raw).slice(0, 500);
  return `PagBank HTTP ${statusCode}`;
}

async function pagbankRequest(method, endpoint, body, extraHeaders = {}) {
  const { token, baseUrl } = config();
  if (!token) {
    throw new Error('PAGBANK_TOKEN não configurado.');
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(formatarErroPagBank(data, response.status));
  }

  return data || {};
}

async function criarPedidoPix({ valor, descricao, cliente }) {
  validarCriacaoPagamento({ valor, descricao, cliente });

  const referenceId = gerarReferenceId();
  const { webhookUrl } = config();
  const payload = {
    reference_id: referenceId,
    customer: {
      name: String(cliente.nome).trim(),
      email: String(cliente.email).trim(),
      tax_id: somenteDigitos(cliente.tax_id)
    },
    items: [
      {
        name: String(descricao).trim().slice(0, 100),
        quantity: 1,
        unit_amount: valor
      }
    ],
    qr_codes: [
      {
        amount: {
          value: valor
        },
        expiration_date: dataExpiracaoPix()
      }
    ]
  };

  if (webhookUrl) {
    payload.notification_urls = [webhookUrl];
  }

  const order = await pagbankRequest('POST', '/orders', payload, {
    'x-idempotency-key': referenceId
  });
  const qrCode = encontrarQrCode(order);
  const qrCodeTexto = textoPixValido(qrCode?.text) ? String(qrCode.text).trim() : null;
  const qrCodeImagem = gerarImagemQrCode(qrCodeTexto) || encontrarLink(qrCode, 'image/png');

  return {
    order,
    id: order.id,
    reference_id: order.reference_id || referenceId,
    qr_code_texto: qrCodeTexto,
    qr_code_imagem: qrCodeImagem
  };
}

async function consultarPedidoPagBank(id) {
  return pagbankRequest('GET', `/orders/${encodeURIComponent(id)}`);
}

function validarAssinaturaWebhook(rawBody, assinaturaRecebida) {
  const { token } = config();
  if (!token || !assinaturaRecebida || !rawBody) return false;

  const assinatura = crypto.createHash('sha256').update(`${token}-${rawBody}`).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(String(assinaturaRecebida)));
  } catch (error) {
    return false;
  }
}

module.exports = {
  consultarPedidoPagBank,
  criarPedidoPix,
  validarAssinaturaWebhook
};
