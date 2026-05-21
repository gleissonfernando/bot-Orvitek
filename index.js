require('dotenv').config();

const express = require('express');
const { buscarPedido, listarPedidos, salvarPedido } = require('./database');
const { criarPedidoPix } = require('./pagbank');
const { processarWebhookPagBank } = require('./webhook');
const { createDashboardVerificationCode, getDashboardAccess } = require('./src/lib/store');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

function validarComprovante(comprovante) {
  if (!comprovante) return { canal: null, destino: null };

  const canal = String(comprovante.canal || '').trim().toLowerCase();
  const destino = String(comprovante.destino || '').trim();

  if (!['gmail', 'discord'].includes(canal)) {
    throw new Error('comprovante.canal deve ser "gmail" ou "discord".');
  }

  if (!destino) {
    throw new Error('comprovante.destino é obrigatório.');
  }

  return { canal, destino };
}

function dashboardTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return String(req.headers['x-dashboard-token'] || '').trim();
}

function requireDashboardToken(req, res, next) {
  const expected = String(process.env.BOT_DASHBOARD_TOKEN || process.env.DASHBOARD_VERIFY_TOKEN || '').trim();
  if (!expected) {
    res.status(503).json({ erro: 'Configure BOT_DASHBOARD_TOKEN para usar a verificação da dashboard.' });
    return;
  }

  if (dashboardTokenFromRequest(req) !== expected) {
    res.status(401).json({ erro: 'Token da dashboard inválido.' });
    return;
  }

  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/dashboard/verificacao', requireDashboardToken, (req, res) => {
  const { guildId, userId, userTag, code, expiresInMinutes } = req.body || {};
  if (!guildId || !userId) {
    res.status(400).json({ erro: 'guildId e userId são obrigatórios.' });
    return;
  }

  const ttlMinutes = Number(expiresInMinutes || 10);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 1440) {
    res.status(400).json({ erro: 'expiresInMinutes deve ser um número entre 1 e 1440.' });
    return;
  }

  const ttlMs = ttlMinutes * 60 * 1000;
  let record;
  try {
    record = createDashboardVerificationCode(String(guildId), String(userId), {
      userTag: userTag || null,
      code,
      ttlMs,
      source: 'dashboard'
    });
  } catch (error) {
    res.status(409).json({ ok: false, message: error.message });
    return;
  }

  res.status(201).json({
    ok: true,
    guildId: record.guildId,
    userId: record.userId,
    code: record.code,
    status: record.status,
    expiresAt: record.expiresAt
  });
});

app.get('/dashboard/acesso/:guildId/:userId', requireDashboardToken, (req, res) => {
  const access = getDashboardAccess(String(req.params.guildId), String(req.params.userId));
  res.json({
    ok: true,
    allowed: Boolean(access?.allowed),
    access: access || null
  });
});

app.post('/pagamento/criar', async (req, res) => {
  try {
    const { valor, descricao, cliente, comprovante } = req.body || {};
    const comprovanteConfig = validarComprovante(comprovante);
    const resultado = await criarPedidoPix({ valor, descricao, cliente });

    const pedido = salvarPedido({
      id: resultado.id,
      reference_id: resultado.reference_id,
      status: 'AGUARDANDO',
      valor,
      descricao,
      qr_code_texto: resultado.qr_code_texto,
      qr_code_imagem: resultado.qr_code_imagem,
      comprovante_canal: comprovanteConfig.canal,
      comprovante_destino: comprovanteConfig.destino,
      cliente_nome: cliente?.nome || null,
      cliente_email: cliente?.email || null,
      cliente_tax_id: cliente?.tax_id || null,
      pagbank_status: 'WAITING'
    });

    res.status(201).json({
      id: pedido.id,
      reference_id: pedido.reference_id,
      status: pedido.status,
      qr_code_texto: pedido.qr_code_texto,
      qr_code_imagem: pedido.qr_code_imagem
    });
  } catch (error) {
    console.error('Erro ao criar pagamento:', error.message);
    res.status(400).json({
      erro: 'Não foi possível criar o pagamento Pix.',
      detalhe: error.message
    });
  }
});

app.post('/webhook/pagbank', async (req, res) => {
  try {
    await processarWebhookPagBank(req);
  } catch (error) {
    console.error('Erro no webhook PagBank:', error);
  }

  res.sendStatus(200);
});

app.get('/pagamento/:id/status', (req, res) => {
  const pedido = buscarPedido(req.params.id);
  if (!pedido) {
    res.status(404).json({ erro: 'Pedido não encontrado.' });
    return;
  }

  res.json({
    id: pedido.id,
    reference_id: pedido.reference_id,
    status: pedido.status,
    pagbank_status: pedido.pagbank_status,
    pago_em: pedido.pago_em,
    comprovante_enviado: Boolean(pedido.comprovante_enviado)
  });
});

app.get('/pagamentos', (_req, res) => {
  res.json(listarPedidos());
});

app.listen(port, () => {
  console.log(`Servidor de pagamentos rodando em http://localhost:${port}`);
});
