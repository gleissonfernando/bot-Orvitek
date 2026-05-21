const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const dbName = process.env.MONGODB_DB_NAME || 'orvitek';
const collectionName = process.env.MONGODB_ORDERS_COLLECTION || 'pedidos';

let clientPromise = null;
let collectionPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function requireMongoUri() {
  if (!uri) {
    throw new Error('Configure MONGODB_URI no .env para usar o MongoDB.');
  }
}

function getClient() {
  requireMongoUri();

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    clientPromise = client.connect();
  }

  return clientPromise;
}

async function getCollection() {
  if (!collectionPromise) {
    collectionPromise = getClient().then(async (client) => {
      const collection = client.db(dbName).collection(collectionName);
      await collection.createIndex({ id: 1 }, { unique: true });
      await collection.createIndex({ reference_id: 1 }, { unique: true });
      await collection.createIndex({ criado_em: -1 });
      console.log(`[MongoDB] Pedidos conectados no banco "${dbName}" na coleção "${collectionName}".`);
      return collection;
    });
  }

  return collectionPromise;
}

function normalizePedido(pedido) {
  if (!pedido) return null;
  const { _id, ...payload } = pedido;
  return payload;
}

function buildPedido(pedido) {
  return {
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
}

async function salvarPedido(pedido) {
  const collection = await getCollection();
  const payload = buildPedido(pedido);

  await collection.insertOne(payload);
  return buscarPedidoPorId(payload.id);
}

async function buscarPedidoPorId(id) {
  const collection = await getCollection();
  return normalizePedido(await collection.findOne({ id }));
}

async function buscarPedidoPorReferencia(referenceId) {
  const collection = await getCollection();
  return normalizePedido(await collection.findOne({ reference_id: referenceId }));
}

async function buscarPedido(idOrReferenceId) {
  const collection = await getCollection();
  return normalizePedido(await collection.findOne({
    $or: [
      { id: idOrReferenceId },
      { reference_id: idOrReferenceId }
    ]
  }));
}

async function listarPedidos() {
  const collection = await getCollection();
  const pedidos = await collection.find({}).sort({ criado_em: -1 }).toArray();
  return pedidos.map(normalizePedido);
}

async function atualizarPedido(idOrReferenceId, campos) {
  const atual = await buscarPedido(idOrReferenceId);
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

  const update = {
    atualizado_em: nowIso()
  };
  for (const [key, value] of entries) {
    update[key] = key === 'comprovante_enviado' ? (value ? 1 : 0) : value;
  }

  const collection = await getCollection();
  await collection.updateOne({ id: atual.id }, { $set: update });
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
