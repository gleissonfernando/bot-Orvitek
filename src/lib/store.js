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
  dashboardVerificationCodes: {},
  dashboardAccess: {},
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
    contract: 1
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
    dashboardVerificationCodes: {
      ...(data.dashboardVerificationCodes || {})
    },
    dashboardAccess: {
      ...(data.dashboardAccess || {})
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

function dashboardCodeKey(guildId, code) {
  return `${guildId}:${normalizeDashboardCode(code)}`;
}

function normalizeDashboardCode(code) {
  return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
}

function dashboardCodeAlreadyExists(data, _guildId, code) {
  const normalizedCode = normalizeDashboardCode(code);
  return Object.values(data.dashboardVerificationCodes)
    .some((entry) => normalizeDashboardCode(entry.code) === normalizedCode);
}

function createRandomDashboardCode(data, guildId) {
  const usedCodes = new Set(
    Object.values(data.dashboardVerificationCodes)
      .map((entry) => normalizeDashboardCode(entry.code))
      .filter((code) => /^\d{4}$/.test(code))
  );
  const availableCount = 10000 - usedCodes.size;

  if (availableCount <= 0) {
    throw new Error('Todos os códigos de 4 dígitos já foram usados no sistema.');
  }

  let selectedIndex = crypto.randomInt(0, availableCount);

  for (let value = 0; value < 10000; value += 1) {
    const code = String(value).padStart(4, '0');
    if (!usedCodes.has(code)) {
      if (selectedIndex === 0) {
        return code;
      }

      selectedIndex -= 1;
    }
  }

  throw new Error('Não foi possível gerar um código único para a dashboard.');
}

function dashboardCodeIsAvailable(guildId, code) {
  const normalizedCode = normalizeDashboardCode(code);
  if (!/^\d{4}$/.test(normalizedCode)) {
    return false;
  }

  return !dashboardCodeAlreadyExists(readDatabase(), guildId, normalizedCode);
}

function chooseDashboardCode(data, guildId, payloadCode) {
  if (/^\d{4}$/.test(payloadCode) && !dashboardCodeAlreadyExists(data, guildId, payloadCode)) {
    return payloadCode;
  }

  return createRandomDashboardCode(data, guildId);
}

function createDashboardVerificationCode(guildId, userId, payload = {}) {
  const data = readDatabase();
  const createdAt = nowIso();
  const ttlMs = Number(payload.ttlMs || 10 * 60 * 1000);
  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 10 * 60 * 1000;
  const expiresAt = payload.expiresAt || new Date(Date.now() + safeTtlMs).toISOString();
  const payloadCode = normalizeDashboardCode(payload.code);
  const code = chooseDashboardCode(data, guildId, payloadCode);
  const key = dashboardCodeKey(guildId, code);

  data.dashboardVerificationCodes[key] = {
    guildId,
    userId: userId || null,
    userTag: payload.userTag || null,
    code,
    status: 'pending',
    source: payload.source || 'bot',
    createdAt,
    expiresAt,
    createdBy: payload.createdBy || null,
    usedAt: null,
    usedBy: null,
    usedByTag: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectReason: null
  };

  writeDatabase(data);
  return data.dashboardVerificationCodes[key];
}

function consumeDashboardVerificationCode(guildId, code, userId, userTag = null) {
  const data = readDatabase();
  const normalizedCode = normalizeDashboardCode(code);
  const key = dashboardCodeKey(guildId, normalizedCode);
  const record = data.dashboardVerificationCodes[key] || null;
  const verifiedAt = nowIso();

  if (!normalizedCode || !record) {
    return { ok: false, reason: 'Código inválido ou expirado.' };
  }

  if (record.status === 'used') {
    return { ok: false, reason: 'Este código já foi usado.' };
  }

  if (record.status === 'revoked') {
    return { ok: false, reason: 'Este código foi cancelado pela equipe.' };
  }

  if (record.expiresAt && Date.now() > new Date(record.expiresAt).getTime()) {
    data.dashboardVerificationCodes[key] = {
      ...record,
      status: 'expired',
      rejectedAt: verifiedAt,
      rejectedBy: userId,
      rejectReason: 'expired'
    };
    writeDatabase(data);
    return { ok: false, reason: 'Este código expirou. Solicite um novo código.' };
  }

  if (record.userId && record.userId !== userId) {
    data.dashboardVerificationCodes[key] = {
      ...record,
      rejectedAt: verifiedAt,
      rejectedBy: userId,
      rejectReason: 'wrong_user'
    };
    writeDatabase(data);
    return { ok: false, reason: 'Este código pertence a outro usuário.' };
  }

  data.dashboardVerificationCodes[key] = {
    ...record,
    status: 'used',
    usedAt: verifiedAt,
    usedBy: userId,
    usedByTag: userTag || null
  };

  const accessKey = guildKey(guildId, userId);
  data.dashboardAccess[accessKey] = {
    ...(data.dashboardAccess[accessKey] || {}),
    guildId,
    userId,
    userTag: userTag || record.userTag || null,
    allowed: true,
    code: normalizedCode,
    grantedAt: verifiedAt,
    grantedBy: record.createdBy || null,
    updatedAt: verifiedAt
  };

  const client = data.clients[accessKey];
  if (client) {
    data.clients[accessKey] = {
      ...client,
      dashboardAccess: true,
      dashboardAccessGrantedAt: verifiedAt,
      dashboardAccessCode: normalizedCode,
      updatedAt: verifiedAt
    };
  }

  writeDatabase(data);
  return {
    ok: true,
    code: data.dashboardVerificationCodes[key],
    access: data.dashboardAccess[accessKey]
  };
}

function getDashboardAccess(guildId, userId) {
  return readDatabase().dashboardAccess[guildKey(guildId, userId)] || null;
}

function listDashboardAccess(guildId, allowed = true) {
  return Object.values(readDatabase().dashboardAccess).filter((entry) =>
    entry.guildId === guildId && (allowed === null || Boolean(entry.allowed) === Boolean(allowed))
  );
}

function listDashboardVerificationCodes(guildId, status = null) {
  return Object.values(readDatabase().dashboardVerificationCodes).filter((entry) =>
    entry.guildId === guildId && (!status || entry.status === status)
  );
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
  consumeDashboardVerificationCode,
  createContract,
  createDashboardVerificationCode,
  createTicket,
  dashboardCodeIsAvailable,
  deleteClient,
  expireClient,
  getClient,
  getContract,
  getDashboardAccess,
  getGuildSetup,
  getPayment,
  getPaymentByPagBankOrderId,
  getQueueEntry,
  listQueueEntries,
  getQueuePosition,
  getReport,
  getRetailPromotion,
  getSystemSettings,
  getTicketByChannel,
  initializeStore,
  listClients,
  listDashboardAccess,
  listDashboardVerificationCodes,
  listTickets,
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
