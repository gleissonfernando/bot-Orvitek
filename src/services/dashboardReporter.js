const os = require('os');
const { Events } = require('discord.js');
const packageInfo = require('../../package.json');

const DASHBOARD_REPORT_INTERVAL_MS = 15 * 1000;
const DASHBOARD_FETCH_TIMEOUT_MS = 5000;
const REPORTER_SYMBOL = Symbol.for('orvitek.dashboardReporter');

function stripTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function truncate(value, maxLength = 500) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getPackageVersion() {
  return packageInfo.version ? `v${packageInfo.version}` : 'v1.0.0';
}

class DashboardReporter {
  constructor(client, env = process.env) {
    this.client = client;
    this.env = env;
    this.messagesHandled = 0;
    this.commandsUsed = 0;
    this.timer = null;
    this.inFlight = false;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = process.hrtime.bigint();
    this.endpoint = this.buildEndpoint();
  }

  buildEndpoint() {
    const baseUrl = stripTrailingSlashes(this.env.DASHBOARD_URL);
    const botId = String(this.env.DASHBOARD_BOT_ID || '').trim();

    if (!baseUrl || !botId) {
      return null;
    }

    return `${baseUrl}/api/bots/${encodeURIComponent(botId)}/metrics`;
  }

  registerEventCounters() {
    this.client.on(Events.MessageCreate, (message) => {
      if (message.author?.bot) return;
      this.messagesHandled += 1;
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      this.commandsUsed += 1;
    });
  }

  start() {
    if (!this.endpoint) {
      console.warn('[Dashboard] Sincronizacao desativada: configure DASHBOARD_URL e DASHBOARD_BOT_ID no .env.');
      return;
    }

    if (typeof fetch !== 'function') {
      console.warn('[Dashboard] Sincronizacao desativada: fetch nativo indisponivel. Use Node.js 18+.');
      return;
    }

    if (!this.env.BOT_DASHBOARD_TOKEN) {
      console.warn('[Dashboard] BOT_DASHBOARD_TOKEN nao configurado. A API pode recusar a sincronizacao.');
    }

    this.report();
    this.timer = setInterval(() => this.report(), DASHBOARD_REPORT_INTERVAL_MS);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    console.log(`[Dashboard] Sincronizacao ativa em ${this.endpoint}.`);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getCpuUsagePercent() {
    const currentTime = process.hrtime.bigint();
    const elapsedMicros = Number(currentTime - this.lastCpuTime) / 1000;
    const usage = process.cpuUsage(this.lastCpuUsage);

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;

    if (!Number.isFinite(elapsedMicros) || elapsedMicros <= 0) {
      return 0;
    }

    return round(((usage.user + usage.system) / elapsedMicros) * 100, 1);
  }

  buildPayload() {
    const memoryUsageMb = process.memoryUsage().rss / 1024 / 1024;
    const uptimeMs = this.client.uptime || (process.uptime() * 1000);

    return {
      name: this.client.user?.username || this.client.user?.tag || 'NomeDoBot',
      status: 'online',
      ping: Math.max(0, Math.round(this.client.ws?.ping || 0)),
      uptime: round(uptimeMs / 1000, 1),
      messagesHandled: this.messagesHandled,
      commandsUsed: this.commandsUsed,
      memoryUsage: round(memoryUsageMb, 1),
      cpuUsage: this.getCpuUsagePercent(),
      server: this.env.SERVER_NAME || os.hostname(),
      version: this.env.BOT_VERSION || getPackageVersion()
    };
  }

  async report() {
    if (this.inFlight || !this.endpoint) return;

    this.inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DASHBOARD_FETCH_TIMEOUT_MS);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.env.BOT_DASHBOARD_TOKEN) {
        headers['X-Dashboard-Token'] = this.env.BOT_DASHBOARD_TOKEN;
        headers['Authorization'] = `Bearer ${this.env.BOT_DASHBOARD_TOKEN}`;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildPayload()),
        signal: controller.signal
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        console.warn(
          `[Dashboard] Falha ao sincronizar metricas: HTTP ${response.status} ${response.statusText}. ` +
            `Resposta: ${truncate(responseText) || 'sem corpo'}`
        );
      }
    } catch (error) {
      console.warn(`[Dashboard] Falha ao sincronizar metricas: ${error.message}`);
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }
}

function registerDashboardReporter(client, env = process.env) {
  if (client[REPORTER_SYMBOL]) {
    return client[REPORTER_SYMBOL];
  }

  const reporter = new DashboardReporter(client, env);
  reporter.registerEventCounters();
  reporter.start();
  client[REPORTER_SYMBOL] = reporter;

  return reporter;
}

module.exports = {
  registerDashboardReporter,
  DashboardReporter
};
