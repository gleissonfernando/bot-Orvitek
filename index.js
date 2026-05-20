require('dotenv').config();

const express = require('express');
const { buscarPedido, listarPedidos, salvarPedido } = require('./database');
const { criarPedidoPix } = require('./pagbank');
const { processarWebhookPagBank } = require('./webhook');

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

app.get('/health', (_req, res) => {
  res.json({ ok: true });
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
