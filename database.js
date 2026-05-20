const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'pagamentos.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  valor INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  qr_code_texto TEXT,
  qr_code_imagem TEXT,
  criado_em TEXT NOT NULL,
  pago_em TEXT,
  comprovante_canal TEXT,
  comprovante_destino TEXT,
  comprovante_enviado INTEGER NOT NULL DEFAULT 0,
  cliente_nome TEXT,
  cliente_email TEXT,
  cliente_tax_id TEXT,
  end_to_end_id TEXT,
  pagbank_status TEXT,
  atualizado_em TEXT
);
`);

function nowIso() {
  return new Date().toISOString();
}

function salvarPedido(pedido) {
  const stmt = db.prepare(`
    INSERT INTO pedidos (
      id,
      reference_id,
      status,
      valor,
      descricao,
      qr_code_texto,
      qr_code_imagem,
      criado_em,
      pago_em,
      comprovante_canal,
      comprovante_destino,
      comprovante_enviado,
      cliente_nome,
      cliente_email,
      cliente_tax_id,
      end_to_end_id,
      pagbank_status,
      atualizado_em
    ) VALUES (
      @id,
      @reference_id,
      @status,
      @valor,
      @descricao,
      @qr_code_texto,
      @qr_code_imagem,
      @criado_em,
      @pago_em,
      @comprovante_canal,
      @comprovante_destino,
      @comprovante_enviado,
      @cliente_nome,
      @cliente_email,
      @cliente_tax_id,
      @end_to_end_id,
      @pagbank_status,
      @atualizado_em
    )
  `);

  const payload = {
    id: pedido.id,
    reference_id: pedido.reference_id,
    status: pedido.status || 'AGUARDANDO',
    valor: pedido.valor,
    descricao: pedido.descricao,
    qr_code_texto: pedido.qr_code_texto || null,
    qr_code_imagem: pedido.qr_code_imagem || null,
    criado_em: pedido.criado_em || nowIso(),
    pago_em: pedido.pago_em || null,
    comprovante_canal: pedido.comprovante_canal || null,
    comprovante_destino: pedido.comprovante_destino || null,
    comprovante_enviado: pedido.comprovante_enviado ? 1 : 0,
    cliente_nome: pedido.cliente_nome || null,
    cliente_email: pedido.cliente_email || null,
    cliente_tax_id: pedido.cliente_tax_id || null,
    end_to_end_id: pedido.end_to_end_id || null,
    pagbank_status: pedido.pagbank_status || null,
    atualizado_em: nowIso()
  };

  stmt.run(payload);
  return buscarPedidoPorId(payload.id);
}

function buscarPedidoPorId(id) {
  return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id) || null;
}

function buscarPedidoPorReferencia(referenceId) {
  return db.prepare('SELECT * FROM pedidos WHERE reference_id = ?').get(referenceId) || null;
}

function buscarPedido(idOrReferenceId) {
  return buscarPedidoPorId(idOrReferenceId) || buscarPedidoPorReferencia(idOrReferenceId);
}

function listarPedidos() {
  return db.prepare('SELECT * FROM pedidos ORDER BY criado_em DESC').all();
}

function atualizarPedido(idOrReferenceId, campos) {
  const atual = buscarPedido(idOrReferenceId);
  if (!atual) return null;

  const permitido = [
    'status',
    'pago_em',
    'comprovante_enviado',
    'end_to_end_id',
    'pagbank_status',
    'qr_code_texto',
    'qr_code_imagem'
  ];
  const entries = Object.entries(campos).filter(([key]) => permitido.includes(key));
  if (!entries.length) return atual;

  const updates = entries.map(([key]) => `${key} = @${key}`);
  updates.push('atualizado_em = @atualizado_em');

  const params = {
    id: atual.id,
    atualizado_em: nowIso()
  };
  for (const [key, value] of entries) {
    params[key] = key === 'comprovante_enviado' ? (value ? 1 : 0) : value;
  }

  db.prepare(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = @id`).run(params);
  return buscarPedidoPorId(atual.id);
}

module.exports = {
  atualizarPedido,
  buscarPedido,
  buscarPedidoPorId,
  buscarPedidoPorReferencia,
  listarPedidos,
  salvarPedido
};
