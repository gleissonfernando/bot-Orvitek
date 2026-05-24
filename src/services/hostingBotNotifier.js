const { MongoClient } = require('mongodb');

const DEFAULT_TIMEOUT_MS = 10000;
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const mongoDbName = process.env.MONGODB_DB_NAME || 'orvitek';
const hostingEventsCollectionName = process.env.MONGODB_HOSTING_EVENTS_COLLECTION || 'hosting_shutdown_events';
const hostingPermissionsCollectionName = process.env.MONGODB_HOSTING_PERMISSIONS_COLLECTION || 'hosting_registration_permissions';

let mongoClientPromise = null;
let hostingEventsCollectionPromise = null;
let hostingPermissionsCollectionPromise = null;

function isHostingBotNotifierEnabled() {
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(process.env.ORVITEK_HOSTING_BOT_ENABLED || '').trim().toLowerCase());
}

function isDebugEnabled() {
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(process.env.ORVITEK_HOSTING_BOT_DEBUG || '').trim().toLowerCase());
}

function debugLog(message, details = {}) {
  if (!isDebugEnabled()) return;
  console.log('[OrvitekHospedagemDebug]', message, JSON.stringify(details, null, 2));
}

function getConfig() {
  const explicitEndpoint = (process.env.ORVITEK_HOSTING_BOT_URL || '').trim();
  const baseUrl = (process.env.HOSTING_BOT_API_URL || '').trim().replace(/\/+$/, '');
  const endpoint = explicitEndpoint || (baseUrl ? `${baseUrl}/api/orvitek/desligar` : '');
  const token = (process.env.ORVITEK_HOSTING_BOT_TOKEN || '').trim();
  const timeoutMs = Number(process.env.ORVITEK_HOSTING_BOT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    endpoint,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function isHostingBotNotifierConfigured() {
  return isHostingBotNotifierEnabled() && Boolean(getConfig().endpoint || mongoUri);
}

function getMongoClient() {
  if (!mongoUri) {
    return null;
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    mongoClientPromise = client.connect();
  }

  return mongoClientPromise;
}

async function getHostingEventsCollection() {
  if (!isHostingBotNotifierEnabled() || !mongoUri) {
    return null;
  }

  if (!hostingEventsCollectionPromise) {
    hostingEventsCollectionPromise = getMongoClient().then(async (client) => {
      const collection = client.db(mongoDbName).collection(hostingEventsCollectionName);
      await collection.createIndex({ eventId: 1 }, { unique: true });
      await collection.createIndex({ status: 1, createdAt: 1 });
      await collection.createIndex({ 'payload.hosting.accessKey': 1 });
      return collection;
    });
  }

  return hostingEventsCollectionPromise;
}

async function getHostingPermissionsCollection() {
  if (!isHostingBotNotifierEnabled() || !mongoUri) {
    return null;
  }

  if (!hostingPermissionsCollectionPromise) {
    hostingPermissionsCollectionPromise = getMongoClient().then(async (client) => {
      const collection = client.db(mongoDbName).collection(hostingPermissionsCollectionName);
      await collection.createIndex({ guildId: 1, userId: 1, accessKey: 1 }, { unique: true });
      await collection.createIndex({ allowed: 1, status: 1, updatedAt: 1 });
      await collection.createIndex({ accessKey: 1 });
      return collection;
    });
  }

  return hostingPermissionsCollectionPromise;
}

function buildShutdownPayload(guild, clientRecord, options = {}) {
  const now = new Date().toISOString();
  const eventId = options.eventId || [
    guild.id,
    clientRecord.userId,
    clientRecord.hostingDueAt || 'sem-vencimento',
    options.eventIdSuffix || null
  ].filter(Boolean).join(':');

  return {
    event: options.event || 'hosting.payment_overdue.shutdown',
    eventId,
    sentAt: now,
    guild: {
      id: guild.id,
      name: guild.name
    },
    client: {
      userId: clientRecord.userId,
      userTag: clientRecord.userTag || null,
      plan: clientRecord.plan || null,
      status: clientRecord.status || null
    },
    hosting: {
      projectName: clientRecord.projectName || null,
      accessKey: clientRecord.accessKey || null,
      status: clientRecord.hostingStatus || null,
      paymentStatus: clientRecord.hostingPaymentStatus || null,
      dueAt: clientRecord.hostingDueAt || null,
      graceUntil: clientRecord.hostingGraceUntil || null,
      cycle: clientRecord.hostingCycle || null,
      projectChannelId: clientRecord.projectChannelId || null,
      paymentTicketChannelId: clientRecord.paymentTicketChannelId || null
    },
    action: {
      type: options.actionType || 'shutdown_client_hosting',
      reason: options.reason || 'Pagamento de hospedagem em atraso.',
      requestedBy: options.byUserId || null
    }
  };
}

async function saveShutdownEventToDatabase(payload) {
  if (!isHostingBotNotifierEnabled()) {
    debugLog('Evento de desligamento nao gravado', {
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado',
      event: payload.event,
      eventId: payload.eventId,
      userId: payload.client?.userId
    });
    return { ok: false, skipped: true, reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado' };
  }

  const collection = await getHostingEventsCollection();
  if (!collection) {
    debugLog('Evento de desligamento nao gravado no MongoDB', {
      reason: 'MONGODB_URI nao configurada',
      event: payload.event,
      eventId: payload.eventId,
      userId: payload.client?.userId,
      projectName: payload.hosting?.projectName,
      accessKey: payload.hosting?.accessKey
    });
    return { ok: false, skipped: true, reason: 'MONGODB_URI nao configurada' };
  }

  const now = new Date().toISOString();
  const result = await collection.updateOne(
    { eventId: payload.eventId },
    {
      $setOnInsert: {
        eventId: payload.eventId,
        event: payload.event,
        status: 'pending',
        payload,
        createdAt: now,
        processedAt: null,
        processingError: null
      },
      $set: {
        updatedAt: now,
        lastPayload: payload
      }
    },
    { upsert: true }
  );

  debugLog('Evento de desligamento gravado para o bot de hospedagem', {
    collection: hostingEventsCollectionName,
    event: payload.event,
    eventId: payload.eventId,
    userId: payload.client?.userId,
    projectName: payload.hosting?.projectName,
    accessKey: payload.hosting?.accessKey,
    inserted: result.upsertedCount > 0,
    matched: result.matchedCount > 0
  });

  return {
    ok: true,
    inserted: result.upsertedCount > 0,
    matched: result.matchedCount > 0,
    collection: hostingEventsCollectionName
  };
}

async function saveHostingRegistrationPermission(guild, clientRecord, options = {}) {
  if (!isHostingBotNotifierEnabled()) {
    debugLog('Permissao de cadastro nao gravada', {
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName
    });
    return { ok: false, skipped: true, reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado' };
  }

  const collection = await getHostingPermissionsCollection();
  if (!collection) {
    debugLog('Permissao de cadastro nao gravada no MongoDB', {
      reason: 'MONGODB_URI nao configurada',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName,
      accessKey: clientRecord?.accessKey,
      allowed: Boolean(options.allowed),
      status: options.status || null
    });
    return { ok: false, skipped: true, reason: 'MONGODB_URI nao configurada' };
  }

  const accessKey = String(clientRecord?.accessKey || '').trim();
  if (!accessKey) {
    debugLog('Permissao de cadastro nao gravada', {
      reason: 'Cliente sem accessKey',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName,
      allowed: Boolean(options.allowed),
      status: options.status || null
    });
    return { ok: false, skipped: true, reason: 'Cliente sem accessKey' };
  }

  const now = new Date().toISOString();
  const allowed = Boolean(options.allowed);
  const status = options.status || (allowed ? 'paid' : 'payment_not_confirmed');
  await collection.updateOne(
    {
      guildId: guild.id,
      userId: clientRecord.userId,
      accessKey
    },
    {
      $set: {
        guildId: guild.id,
        guildName: guild.name,
        userId: clientRecord.userId,
        userTag: clientRecord.userTag || null,
        accessKey,
        projectName: clientRecord.projectName || null,
        plan: clientRecord.plan || null,
        allowed,
        status,
        paymentStatus: clientRecord.hostingPaymentStatus || null,
        hostingStatus: clientRecord.hostingStatus || null,
        dueAt: clientRecord.hostingDueAt || null,
        graceUntil: clientRecord.hostingGraceUntil || null,
        reason: options.reason || null,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );

  debugLog('Permissao de cadastro atualizada para o bot de hospedagem', {
    collection: hostingPermissionsCollectionName,
    guildId: guild.id,
    userId: clientRecord.userId,
    userTag: clientRecord.userTag || null,
    projectName: clientRecord.projectName || null,
    accessKey,
    allowed,
    status,
    reason: options.reason || null
  });

  return { ok: true, allowed, status, collection: hostingPermissionsCollectionName };
}

async function deleteHostingRegistrationPermission(guild, clientRecord) {
  if (!isHostingBotNotifierEnabled()) {
    debugLog('Cadastro de hospedagem nao removido do MongoDB', {
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName
    });
    return { ok: false, skipped: true, reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado' };
  }

  const collection = await getHostingPermissionsCollection();
  if (!collection) {
    debugLog('Cadastro de hospedagem nao removido do MongoDB', {
      reason: 'MONGODB_URI nao configurada',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName
    });
    return { ok: false, skipped: true, reason: 'MONGODB_URI nao configurada' };
  }

  const result = await collection.deleteMany({
    guildId: guild.id,
    userId: clientRecord.userId
  });

  debugLog('Cadastro de hospedagem removido do MongoDB', {
    collection: hostingPermissionsCollectionName,
    guildId: guild.id,
    userId: clientRecord.userId,
    userTag: clientRecord.userTag || null,
    projectName: clientRecord.projectName || null,
    deletedCount: result.deletedCount
  });

  return {
    ok: true,
    deletedCount: result.deletedCount,
    collection: hostingPermissionsCollectionName
  };
}

async function sendShutdownEventByHttp(payload) {
  if (!isHostingBotNotifierEnabled()) {
    debugLog('POST para bot de hospedagem nao enviado', {
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado',
      event: payload.event,
      eventId: payload.eventId,
      userId: payload.client?.userId
    });
    return { ok: false, skipped: true, reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado' };
  }

  const config = getConfig();
  if (!config.endpoint) {
    debugLog('POST para bot de hospedagem nao enviado', {
      reason: 'ORVITEK_HOSTING_BOT_URL nao configurada',
      event: payload.event,
      eventId: payload.eventId,
      userId: payload.client?.userId,
      projectName: payload.hosting?.projectName,
      accessKey: payload.hosting?.accessKey
    });
    return { ok: false, skipped: true, reason: 'ORVITEK_HOSTING_BOT_URL nao configurada' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    debugLog('Enviando POST para o bot de hospedagem', {
      endpoint: config.endpoint,
      event: payload.event,
      eventId: payload.eventId,
      userId: payload.client?.userId,
      userTag: payload.client?.userTag,
      projectName: payload.hosting?.projectName,
      accessKey: payload.hosting?.accessKey,
      action: payload.action?.type,
      reason: payload.action?.reason
    });

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Orvitek-Bots/1.0',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await response.text().catch(() => '');
    if (!response.ok) {
      debugLog('Bot de hospedagem respondeu com erro', {
        endpoint: config.endpoint,
        eventId: payload.eventId,
        status: response.status,
        body: responseText.slice(0, 500)
      });
      return {
        ok: false,
        status: response.status,
        body: responseText.slice(0, 500),
        payload
      };
    }

    debugLog('Bot de hospedagem respondeu OK', {
      endpoint: config.endpoint,
      eventId: payload.eventId,
      status: response.status,
      body: responseText.slice(0, 500)
    });

    return {
      ok: true,
      status: response.status,
      body: responseText.slice(0, 500),
      payload
    };
  } catch (error) {
    debugLog('Falha ao conversar com o bot de hospedagem', {
      endpoint: config.endpoint,
      eventId: payload.eventId,
      error: error.name === 'AbortError' ? 'timeout' : error.message
    });
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
      payload
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyHostingBotShutdown(guild, clientRecord, options = {}) {
  if (!isHostingBotNotifierEnabled()) {
    debugLog('Comunicacao com bot de hospedagem ignorada', {
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado',
      guildId: guild.id,
      userId: clientRecord?.userId,
      projectName: clientRecord?.projectName
    });
    return {
      ok: false,
      skipped: true,
      reason: 'ORVITEK_HOSTING_BOT_ENABLED desativado'
    };
  }

  const payload = buildShutdownPayload(guild, clientRecord, options);
  debugLog('Iniciando comunicacao de desligamento com Orvitek Hospedagem', {
    event: payload.event,
    eventId: payload.eventId,
    userId: payload.client?.userId,
    projectName: payload.hosting?.projectName,
    accessKey: payload.hosting?.accessKey,
    action: payload.action?.type
  });

  const [database, http] = await Promise.all([
    saveShutdownEventToDatabase(payload).catch((error) => ({
      ok: false,
      error: error.message
    })),
    sendShutdownEventByHttp(payload)
  ]);

  debugLog('Resultado da comunicacao de desligamento com Orvitek Hospedagem', {
    eventId: payload.eventId,
    ok: database.ok || http.ok,
    database,
    http
  });

  return {
    ok: database.ok || http.ok,
    payload,
    database,
    http
  };
}

module.exports = {
  buildShutdownPayload,
  deleteHostingRegistrationPermission,
  isHostingBotNotifierEnabled,
  isHostingBotNotifierConfigured,
  saveHostingRegistrationPermission,
  saveShutdownEventToDatabase,
  notifyHostingBotShutdown
};
