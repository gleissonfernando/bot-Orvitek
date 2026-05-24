const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'database.json');
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const mongoDbName = process.env.MONGODB_DB_NAME || 'orvitek';
const mongoStoreCollection = process.env.MONGODB_STORE_COLLECTION || 'bot_store';
const mongoStoreDocumentId = process.env.MONGODB_STORE_DOCUMENT_ID || 'default';

let memoryData = null;
let mongoClientPromise = null;
let mongoCollectionPromise = null;
let mongoWritePromise = Promise.resolve();

const initialData = {
  setup: {
    guilds: {}
  },
  settings: {},
  retail: {},
  queues: {},
  contracts: {},
  payments: {},
  clients: {},
  tickets: {},
  moderation: {},
  ratings: [],
  suggestions: [],
  counters: {
    ticket: 1,
    suggestion: 1,
    contract: 1,
    product: 1,
    order: 1
  }
};

function mergeDefaults(data) {
  return {
    ...initialData,
    ...data,
    setup: {
      ...initialData.setup,
      ...(data.setup || {}),
      guilds: {
        ...(data.setup?.guilds || {})
      }
    },
    settings: {
      ...(data.settings || {})
    },
    retail: {
      products: [],
      orders: [],
      ...(data.retail || {})
    },
    counters: {
      ...initialData.counters,
      ...(data.counters || {})
    }
  };
}

function useMongoStore() {
  return Boolean(mongoUri);
}

function getMongoClient() {
  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    mongoClientPromise = client.connect();
  }

  return mongoClientPromise;
}

async function getMongoCollection() {
  if (!mongoCollectionPromise) {
    mongoCollectionPromise = getMongoClient().then((client) => client.db(mongoDbName).collection(mongoStoreCollection));
  }

  return mongoCollectionPromise;
}

async function initializeStore() {
  if (!useMongoStore()) {
    ensureDatabase();
    memoryData = mergeDefaults(JSON.parse(fs.readFileSync(dbPath, 'utf8')));
    return memoryData;
  }

  const collection = await getMongoCollection();
  const document = await collection.findOne({ _id: mongoStoreDocumentId });
  memoryData = mergeDefaults(document?.data || {});
  console.log(`[MongoDB] Conectado ao banco "${mongoDbName}" na coleção "${mongoStoreCollection}".`);

  if (!document) {
    await collection.replaceOne(
      { _id: mongoStoreDocumentId },
      { _id: mongoStoreDocumentId, data: memoryData, updatedAt: nowIso() },
      { upsert: true }
    );
  }

  return memoryData;
}

function ensureDatabase() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
  }
}

function readDatabase() {
  if (memoryData) {
    return mergeDefaults(memoryData);
  }

  ensureDatabase();
  memoryData = mergeDefaults(JSON.parse(fs.readFileSync(dbPath, 'utf8')));
  return memoryData;
}

function writeDatabase(data) {
  memoryData = mergeDefaults(data);

  if (useMongoStore()) {
    mongoWritePromise = mongoWritePromise
      .then(async () => {
        const collection = await getMongoCollection();
        await collection.replaceOne(
          { _id: mongoStoreDocumentId },
          { _id: mongoStoreDocumentId, data: memoryData, updatedAt: nowIso() },
          { upsert: true }
        );
      })
      .catch((error) => {
        console.error(`Nao foi possivel salvar dados no MongoDB: ${error.message}`);
      });
    return;
  }

  ensureDatabase();
  fs.writeFileSync(dbPath, JSON.stringify(memoryData, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function getHostingCycleKey(date = new Date()) {
  const value = new Date(date);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getNextHostingDueDate(date = new Date()) {
  const value = new Date(date);
  const currentDay = value.getUTCDate();
  const due = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 8, 12, 0, 0));
  if (currentDay > 8) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 8, 12, 0, 0));
  }
  return due;
}

function getHostingGraceDeadline(dueDate) {
  const date = cloneDate(new Date(dueDate));
  date.setUTCDate(date.getUTCDate() + 15);
  return date;
}

function defaultSystemSettings() {
  return {
    prices: {
      basic: 50,
      premium: 250,
      lifetime: 450,
      fivemFac: 150,
      hosting: 12
    },
    coupon: {
      active: false,
      code: null,
      percent: 0,
      updatedAt: null,
      updatedBy: null
    },
    boost: {
      percent: 5,
      updatedAt: null,
      updatedBy: null
    },
    ui: {
      systemPanelChannelId: null
    },
    retail: {
      active: false,
      updatedAt: null,
      updatedBy: null
    },
    payment: {
      mode: 'pagbank',
      pixKey: null,
      pixKeyLabel: null,
      qrCodeText: null,
      qrCodeImageUrl: null,
      updatedAt: null,
      updatedBy: null
    }
  };
}

function guildKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function saveGuildSetup(guildId, setup) {
  const data = readDatabase();
  data.setup.guilds[guildId] = {
    ...(data.setup.guilds[guildId] || {}),
    ...setup,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.setup.guilds[guildId];
}

function getGuildSetup(guildId) {
  return readDatabase().setup.guilds[guildId] || null;
}

function getSystemSettings(guildId) {
  const data = readDatabase();
  return {
    ...defaultSystemSettings(),
    ...(data.settings[guildId] || {}),
    prices: {
      ...defaultSystemSettings().prices,
      ...(data.settings[guildId]?.prices || {})
    },
    coupon: {
      ...defaultSystemSettings().coupon,
      ...(data.settings[guildId]?.coupon || {})
    },
    boost: {
      ...defaultSystemSettings().boost,
      ...(data.settings[guildId]?.boost || {})
    },
    ui: {
      ...defaultSystemSettings().ui,
      ...(data.settings[guildId]?.ui || {})
    },
    retail: {
      ...defaultSystemSettings().retail,
      ...(data.settings[guildId]?.retail || {})
    },
    payment: {
      ...defaultSystemSettings().payment,
      ...(data.settings[guildId]?.payment || {})
    }
  };
}

function updateSystemSettings(guildId, payload) {
  const data = readDatabase();
  const current = getSystemSettings(guildId);
  data.settings[guildId] = {
    ...current,
    ...payload,
    prices: {
      ...current.prices,
      ...(payload.prices || {})
    },
    coupon: {
      ...current.coupon,
      ...(payload.coupon || {})
    },
    boost: {
      ...current.boost,
      ...(payload.boost || {})
    },
    ui: {
      ...current.ui,
      ...(payload.ui || {})
    },
    retail: {
      ...current.retail,
      ...(payload.retail || {})
    },
    payment: {
      ...current.payment,
      ...(payload.payment || {})
    }
  };
  writeDatabase(data);
  return data.settings[guildId];
}

function getRetailPromotion(guildId) {
  return getSystemSettings(guildId).retail;
}

function createProduct(payload) {
  const data = readDatabase();
  const product = {
    id: data.counters.product++,
    name: String(payload.name || '').trim(),
    price: Number(payload.price || 0),
    description: String(payload.description || '').trim(),
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  data.retail.products.push(product);
  writeDatabase(data);
  return product;
}

function listProducts() {
  return readDatabase().retail.products || [];
}

function findProduct(productId) {
  const id = Number(productId);
  return listProducts().find((product) => product.id === id && product.active) || null;
}

function removeProduct(productId) {
  const data = readDatabase();
  const id = Number(productId);
  const product = data.retail.products.find((entry) => entry.id === id && entry.active);

  if (!product) {
    return null;
  }

  product.active = false;
  product.updatedAt = nowIso();
  writeDatabase(data);
  return product;
}

function createOrder(payload) {
  const data = readDatabase();
  const order = {
    id: data.counters.order++,
    customerId: payload.customerId,
    customerTag: payload.customerTag,
    productId: payload.product.id,
    productName: payload.product.name,
    amount: payload.product.price,
    status: 'pendente',
    notes: payload.notes || '',
    sellerId: payload.sellerId,
    sellerTag: payload.sellerTag,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  data.retail.orders.push(order);
  writeDatabase(data);
  return order;
}

function listOrders(status = null) {
  return (readDatabase().retail.orders || []).filter((order) => !status || order.status === status);
}

function updateOrderStatus(orderId, status) {
  const data = readDatabase();
  const id = Number(orderId);
  const order = data.retail.orders.find((entry) => entry.id === id);

  if (!order) {
    return null;
  }

  order.status = status;
  order.updatedAt = nowIso();
  writeDatabase(data);
  return order;
}

function listCustomerOrders(customerId) {
  return (readDatabase().retail.orders || []).filter((order) => order.customerId === customerId);
}

function getSummary() {
  const data = readDatabase();
  const products = (data.retail.products || []).filter((product) => product.active);
  const orders = data.retail.orders || [];
  const paidOrders = orders.filter((order) => ['pago', 'entregue'].includes(order.status));
  const byStatus = orders.reduce((summary, order) => {
    summary[order.status] = (summary[order.status] || 0) + 1;
    return summary;
  }, {});

  return {
    products: products.length,
    orders: orders.length,
    revenue: paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
    byStatus
  };
}

function setRetailPromotion(guildId, payload) {
  return updateSystemSettings(guildId, {
    retail: {
      ...payload,
      updatedAt: nowIso()
    }
  }).retail;
}

function setSystemCoupon(guildId, payload) {
  return updateSystemSettings(guildId, {
    coupon: {
      ...payload,
      updatedAt: nowIso()
    }
  }).coupon;
}

function clearSystemCoupon(guildId, updatedBy = null) {
  return updateSystemSettings(guildId, {
    coupon: {
      active: false,
      code: null,
      percent: 0,
      updatedAt: nowIso(),
      updatedBy
    }
  }).coupon;
}

function upsertClient(guildId, userId, payload) {
  const data = readDatabase();
  const key = guildKey(guildId, userId);
  data.clients[key] = {
    ...(data.clients[key] || {}),
    guildId,
    userId,
    ...payload,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.clients[key];
}

function getClient(guildId, userId) {
  return readDatabase().clients[guildKey(guildId, userId)] || null;
}

function deleteClient(guildId, userId) {
  const data = readDatabase();
  const key = guildKey(guildId, userId);
  const client = data.clients[key] || null;
  if (!client) {
    return null;
  }

  delete data.clients[key];
  writeDatabase(data);
  return client;
}

function listClients(guildId, status = 'active') {
  return Object.values(readDatabase().clients).filter((client) => client.guildId === guildId && (!status || client.status === status));
}

function expireClient(guildId, userId) {
  return upsertClient(guildId, userId, { status: 'expired', expiredAt: nowIso() });
}

function createTicket({ guildId, channelId, ownerId, ownerTag, type }) {
  const data = readDatabase();
  const ticket = {
    id: data.counters.ticket++,
    guildId,
    channelId,
    ownerId,
    ownerTag,
    type,
    status: 'open',
    claimedBy: null,
    createdAt: nowIso(),
    closedAt: null
  };
  data.tickets[channelId] = ticket;
  writeDatabase(data);
  return ticket;
}

function getTicketByChannel(channelId) {
  return readDatabase().tickets[channelId] || null;
}

function updateTicket(channelId, payload) {
  const data = readDatabase();
  const ticket = data.tickets[channelId];
  if (!ticket) {
    return null;
  }

  data.tickets[channelId] = {
    ...ticket,
    ...payload,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.tickets[channelId];
}

function upsertQueueEntry(channelId, payload) {
  const data = readDatabase();
  data.queues[channelId] = {
    ...(data.queues[channelId] || {}),
    channelId,
    ...payload,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.queues[channelId];
}

function getQueueEntry(channelId) {
  return readDatabase().queues[channelId] || null;
}

function listQueueEntries(guildId = null, ownerId = null) {
  return Object.values(readDatabase().queues).filter((entry) =>
    (!guildId || entry.guildId === guildId) && (!ownerId || entry.ownerId === ownerId)
  );
}

function getQueuePosition(guildId, channelId) {
  const entries = Object.values(readDatabase().queues)
    .filter((entry) => entry.guildId === guildId && ['approved', 'development'].includes(entry.status))
    .sort((a, b) => new Date(a.approvedAt || a.createdAt || 0) - new Date(b.approvedAt || b.createdAt || 0));
  const index = entries.findIndex((entry) => entry.channelId === channelId);
  return {
    ahead: index === -1 ? entries.length : index,
    position: index === -1 ? entries.length + 1 : index + 1
  };
}

function createContract(channelId, payload) {
  const data = readDatabase();
  const contract = {
    id: data.counters.contract++,
    channelId,
    ...payload,
    signedAt: nowIso()
  };
  data.contracts[channelId] = contract;
  writeDatabase(data);
  return contract;
}

function getContract(channelId) {
  return readDatabase().contracts[channelId] || null;
}

function paymentKey(channelId, type = 'entry') {
  return `${channelId}:${type}`;
}

function upsertPayment(channelId, payload, type = 'entry') {
  const data = readDatabase();
  const key = paymentKey(channelId, type);
  data.payments[key] = {
    ...(data.payments[key] || {}),
    channelId,
    type,
    ...payload,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.payments[key];
}

function getPayment(channelId, type = 'entry') {
  return readDatabase().payments[paymentKey(channelId, type)] || null;
}

function getPaymentByPagBankOrderId(orderId) {
  if (!orderId) return null;
  return Object.values(readDatabase().payments).find((payment) => payment.provider === 'pagbank' && payment.orderId === orderId) || null;
}

function updatePaymentByPagBankOrderId(orderId, payload) {
  const data = readDatabase();
  const entry = Object.entries(data.payments).find(([, payment]) => payment.provider === 'pagbank' && payment.orderId === orderId);
  if (!entry) return null;

  const [key, current] = entry;
  data.payments[key] = {
    ...current,
    ...payload,
    updatedAt: nowIso()
  };
  writeDatabase(data);
  return data.payments[key];
}

function listTickets(guildId, status) {
  return Object.values(readDatabase().tickets).filter((ticket) => ticket.guildId === guildId && (!status || ticket.status === status));
}

function addWarning(guildId, userId, reason) {
  const data = readDatabase();
  const key = guildKey(guildId, userId);
  const record = data.moderation[key] || { guildId, userId, strikes: 0, events: [] };
  record.strikes += 1;
  record.events.push({ reason, createdAt: nowIso() });
  data.moderation[key] = record;
  writeDatabase(data);
  return record;
}

function addRating(guildId, userId, stars, ticketId = null) {
  const data = readDatabase();
  data.ratings.push({ guildId, userId, stars, ticketId, createdAt: nowIso() });
  writeDatabase(data);
}

function addSuggestion(guildId, userId, userTag, content) {
  const data = readDatabase();
  const suggestion = {
    id: data.counters.suggestion++,
    guildId,
    userId,
    userTag,
    content,
    createdAt: nowIso()
  };
  data.suggestions.push(suggestion);
  writeDatabase(data);
  return suggestion;
}

function getReport(guildId) {
  const data = readDatabase();
  const tickets = Object.values(data.tickets).filter((ticket) => ticket.guildId === guildId);
  const ratings = data.ratings.filter((rating) => rating.guildId === guildId);
  const averageRating = ratings.length
    ? ratings.reduce((sum, rating) => sum + rating.stars, 0) / ratings.length
    : 0;

  return {
    activeClients: listClients(guildId, 'active').length,
    expiredClients: listClients(guildId, 'expired').length,
    openTickets: tickets.filter((ticket) => ticket.status === 'open').length,
    resolvedTickets: tickets.filter((ticket) => ticket.status === 'closed').length,
    averageRating
  };
}

module.exports = {
  addRating,
  addSuggestion,
  addWarning,
  createContract,
  createOrder,
  createProduct,
  createTicket,
  deleteClient,
  expireClient,
  findProduct,
  getClient,
  getContract,
  getGuildSetup,
  getPayment,
  getPaymentByPagBankOrderId,
  getQueueEntry,
  listQueueEntries,
  getQueuePosition,
  getReport,
  getRetailPromotion,
  getSummary,
  getSystemSettings,
  getTicketByChannel,
  initializeStore,
  listClients,
  listCustomerOrders,
  listOrders,
  listProducts,
  listTickets,
  removeProduct,
  getHostingCycleKey,
  getNextHostingDueDate,
  getHostingGraceDeadline,
  saveGuildSetup,
  setSystemCoupon,
  setRetailPromotion,
  clearSystemCoupon,
  updateSystemSettings,
  updatePaymentByPagBankOrderId,
  updateTicket,
  upsertPayment,
  upsertQueueEntry,
  upsertClient
};
