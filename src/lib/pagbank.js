const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');

const SANDBOX_URL = 'https://sandbox.api.pagseguro.com';
const PRODUCTION_URL = 'https://api.pagseguro.com';

function getPagBankConfig() {
  const token = process.env.PAGBANK_TOKEN || process.env.PAGSEGURO_TOKEN || '';
  const environment = String(process.env.PAGBANK_ENV || 'sandbox').toLowerCase();
  const baseUrl = process.env.PAGBANK_API_URL || process.env.PAGBANK_URL || (environment === 'production' ? PRODUCTION_URL : SANDBOX_URL);
  const notificationUrl = process.env.PAGBANK_NOTIFICATION_URL || '';
  const expirationMinutes = Number(process.env.PAGBANK_QR_EXPIRATION_MINUTES || 1440);

  return {
    token,
    environment,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    notificationUrl,
    expirationMinutes: Number.isFinite(expirationMinutes) && expirationMinutes > 0 ? expirationMinutes : 1440
  };
}

function isPagBankConfigured() {
  return Boolean(getPagBankConfig().token);
}

function moneyToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Valor de pagamento inválido.');
  }

  return Math.round(amount * 100);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function splitName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  return cleaned || 'Cliente Orvitek';
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidCpf(value) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function isValidCnpj(value) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calc = (base, factors) => {
    const sum = factors.reduce((total, factor, index) => total + Number(base[index]) * factor, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const first = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

function validatePagBankCustomer(contract, discordUser = null) {
  const errors = [];
  const name = splitName(contract?.fullName || discordUser?.username);
  const email = String(contract?.email || '').trim();
  const taxId = digits(contract?.cpf);

  if (name.length < 5 || name.length > 60) {
    errors.push('nome completo entre 5 e 60 caracteres');
  }

  if (!isValidEmail(email)) {
    errors.push('e-mail válido');
  }

  if (!isValidCpf(taxId) && !isValidCnpj(taxId)) {
    errors.push('CPF ou CNPJ válido');
  }

  if (errors.length) {
    throw new Error(`Dados do contrato inválidos para o PagBank. Informe ${errors.join(', ')} e assine o contrato novamente.`);
  }

  return {
    name,
    email,
    taxId
  };
}

function parseBrazilianPhone(input) {
  const phone = digits(input);
  if (phone.length < 10) return null;

  const normalized = phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : phone;
  const area = normalized.slice(0, 2);
  const number = normalized.slice(2, 11);
  if (area.length !== 2 || number.length < 8) return null;

  return {
    country: '55',
    area,
    number,
    type: 'MOBILE'
  };
}

function toIsoExpiration(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function requestJson(method, endpoint, payload = null, extraHeaders = {}) {
  const config = getPagBankConfig();
  if (!config.token) {
    return Promise.reject(new Error('Configure PAGBANK_TOKEN no arquivo .env.'));
  }

  const url = new URL(`${config.baseUrl}${endpoint}`);
  const body = payload ? JSON.stringify(payload) : null;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    accept: 'application/json',
    ...extraHeaders
  };

  if (body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;

          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch (error) {
              data = { raw };
            }
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data || {});
            return;
          }

          const message = formatPagBankError(data, res.statusCode);
          const error = new Error(message);
          error.statusCode = res.statusCode;
          error.response = data;
          reject(error);
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildCustomer(contract, discordUser) {
  const phone = parseBrazilianPhone(contract.phoneAndPayment);
  const customerData = validatePagBankCustomer(contract, discordUser);
  const customer = {
    name: customerData.name,
    email: customerData.email,
    tax_id: customerData.taxId
  };

  if (phone) {
    customer.phones = [phone];
  }

  return customer;
}

function getQrCode(order) {
  const qrCodes = order?.qr_codes || order?.qr_code || [];
  if (Array.isArray(qrCodes)) return qrCodes[0] || null;
  return qrCodes && typeof qrCodes === 'object' ? qrCodes : null;
}

function findQrLink(qrCode, media) {
  const expectedRel = media === 'image/png' ? 'PNG' : 'BASE64';
  return (qrCode?.links || []).find((link) => (
    String(link.media || '').toLowerCase() === media ||
    String(link.rel || '').toUpperCase().includes(expectedRel)
  ))?.href || null;
}

function buildQrCodeImageUrl(qrCodeText) {
  const text = String(qrCodeText || '').trim();
  if (!text) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(text)}`;
}

function isPixCopyPasteText(value) {
  const text = String(value || '').trim();
  return /^000201/.test(text) && /6304[0-9A-F]{4}$/i.test(text) && text.length >= 80;
}

async function buildPixPaymentFromOrder(order, amountCents, referenceId) {
  const qrCode = getQrCode(order);
  const charge = Array.isArray(order.charges) ? order.charges[0] || null : null;
  const qrCodeTextLink = findQrLink(qrCode, 'text/plain');
  const qrCodeText = isPixCopyPasteText(qrCode?.text) ? String(qrCode.text).trim() : null;
  const qrCodePng = buildQrCodeImageUrl(qrCodeText) || findQrLink(qrCode, 'image/png');

  return {
    provider: 'pagbank',
    referenceId,
    orderId: order.id || null,
    chargeId: charge?.id || null,
    qrCodeId: qrCode?.id || null,
    qrCodeText,
    qrCodePng,
    qrCodeBase64: qrCodeTextLink,
    amountCents,
    status: isOrderPaid(order, amountCents) ? 'paid' : 'awaiting_payment',
    rawStatus: charge?.status || null,
    createdAt: new Date().toISOString(),
    expiresAt: qrCode?.expiration_date || null
  };
}

async function createPixOrder({ contract, discordUser, amount, description, referenceId, notificationUrl = null }) {
  const config = getPagBankConfig();
  const amountCents = moneyToCents(amount);
  const finalNotificationUrl = notificationUrl || config.notificationUrl;
  const body = {
    reference_id: referenceId,
    customer: buildCustomer(contract, discordUser),
    items: [
      {
        reference_id: referenceId.slice(0, 64),
        name: String(description || 'Pagamento Orvitek').slice(0, 100),
        quantity: 1,
        unit_amount: amountCents
      }
    ],
    qr_codes: [
      {
        amount: {
          value: amountCents
        },
        expiration_date: toIsoExpiration(config.expirationMinutes)
      }
    ]
  };

  if (finalNotificationUrl) {
    body.notification_urls = [finalNotificationUrl];
  }

  const order = await requestJson('POST', '/orders', body, {
    'x-idempotency-key': referenceId
  });

  return {
    order,
    payment: await buildPixPaymentFromOrder(order, amountCents, referenceId)
  };
}

async function consultOrder(orderId) {
  if (!orderId) {
    throw new Error('Pedido PagBank não informado.');
  }

  return requestJson('GET', `/orders/${encodeURIComponent(orderId)}`);
}

function isOrderPaid(order, expectedAmountCents = null) {
  const charges = Array.isArray(order?.charges) ? order.charges : [];
  return charges.some((charge) => {
    if (charge.status !== 'PAID') return false;
    if (!expectedAmountCents) return true;
    const paid = Number(charge.amount?.summary?.paid ?? charge.amount?.value ?? 0);
    return paid >= expectedAmountCents;
  });
}

function summarizeOrderStatus(order, expectedAmountCents = null) {
  const charges = Array.isArray(order?.charges) ? order.charges : [];
  const paidCharge = charges.find((charge) => charge.status === 'PAID');
  const firstCharge = charges[0] || null;

  return {
    paid: isOrderPaid(order, expectedAmountCents),
    status: paidCharge?.status || firstCharge?.status || 'WAITING',
    paidAt: paidCharge?.paid_at || null,
    chargeId: paidCharge?.id || firstCharge?.id || null
  };
}

function verifyWebhookSignature(rawBody, receivedSignature) {
  const token = getPagBankConfig().token;
  if (!token || !receivedSignature) return false;

  const expected = crypto.createHash('sha256').update(`${token}-${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(receivedSignature)));
  } catch (error) {
    return false;
  }
}

function isBuyerMerchantEmailError(message) {
  return String(message || '').toLowerCase().includes('buyer email must not be equals to merchant email');
}

function isInvalidCredentialError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('invalid credential') || text.includes('review authorization');
}

function formatPagBankError(data, statusCode = null) {
  const prefix = statusCode ? `PagBank HTTP ${statusCode}` : 'PagBank';
  if (!data) return `${prefix}: resposta vazia.`;
  if (data.error_messages?.length) {
    const messages = data.error_messages.map((item) => item.description || item.message || item.code).filter(Boolean);
    if (messages.some(isBuyerMerchantEmailError)) {
      return `${prefix}: o e-mail do comprador não pode ser igual ao e-mail da conta vendedora do PagBank. Corrija o e-mail no contrato e tente novamente.`;
    }
    if (messages.some(isInvalidCredentialError)) {
      return `${prefix}: credencial PagBank inválida. Use um PAGBANK_TOKEN de produção quando PAGBANK_ENV=production ou volte a URL/ambiente para sandbox com token sandbox.`;
    }
    return `${prefix}: ${messages.join('; ')}`;
  }
  if (isBuyerMerchantEmailError(data.message)) {
    return `${prefix}: o e-mail do comprador não pode ser igual ao e-mail da conta vendedora do PagBank. Corrija o e-mail no contrato e tente novamente.`;
  }
  if (isInvalidCredentialError(data.message) || isInvalidCredentialError(data.raw)) {
    return `${prefix}: credencial PagBank inválida. Use um PAGBANK_TOKEN de produção quando PAGBANK_ENV=production ou volte a URL/ambiente para sandbox com token sandbox.`;
  }
  if (data.message) return `${prefix}: ${data.message}`;
  if (data.raw) return `${prefix}: ${String(data.raw).slice(0, 300)}`;
  return `${prefix}: erro ao processar pagamento.`;
}

module.exports = {
  buildPixPaymentFromOrder,
  consultOrder,
  createPixOrder,
  getPagBankConfig,
  isOrderPaid,
  isPagBankConfigured,
  isPixCopyPasteText,
  isBuyerMerchantEmailError,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  moneyToCents,
  summarizeOrderStatus,
  validatePagBankCustomer,
  verifyWebhookSignature
};
