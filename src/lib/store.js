const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'database.json');

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
    counters: {
      ...initialData.counters,
      ...(data.counters || {})
    }
  };
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
  ensureDatabase();
  return mergeDefaults(JSON.parse(fs.readFileSync(dbPath, 'utf8')));
}

function writeDatabase(data) {
  ensureDatabase();
  fs.writeFileSync(dbPath, JSON.stringify(mergeDefaults(data), null, 2));
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
  createContract,
  createTicket,
  deleteClient,
  expireClient,
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
  getSystemSettings,
  getTicketByChannel,
  listClients,
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
