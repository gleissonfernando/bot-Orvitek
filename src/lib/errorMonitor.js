const fs = require('node:fs');
const path = require('node:path');

const logsDir = path.join(process.cwd(), 'logs');
const errorLogPath = path.join(logsDir, 'errors.log');

function redact(value) {
  return String(value || '')
    .replace(/([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[token-redacted]')
    .replace(/(token=)[^&\s]+/gi, '$1[token-redacted]')
    .replace(/(DISCORD_TOKEN=)[^\s]+/gi, '$1[token-redacted]')
    .replace(/(PAGBANK_TOKEN=)[^\s]+/gi, '$1[token-redacted]');
}

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function errorDetails(error) {
  if (!error) return 'Erro desconhecido';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ''}`;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function logError(scope, error, extra = {}) {
  const timestamp = new Date().toISOString();
  const details = redact(errorDetails(error));
  const extraText = Object.keys(extra).length ? `\nextra=${redact(JSON.stringify(extra))}` : '';
  const message = `[${timestamp}] [${scope}] ${details}${extraText}`;

  console.error(message);

  try {
    ensureLogsDir();
    fs.appendFileSync(errorLogPath, `${message}\n\n`);
  } catch (writeError) {
    console.error(`[ErrorMonitor] Nao foi possivel gravar log local: ${writeError.message}`);
  }
}

function registerErrorMonitor(client = null) {
  process.on('unhandledRejection', (error) => {
    logError('unhandledRejection', error);
  });

  process.on('uncaughtException', (error) => {
    logError('uncaughtException', error);
  });

  process.on('warning', (warning) => {
    logError('processWarning', warning);
  });

  if (client) {
    client.on('error', (error) => logError('discordClientError', error));
    client.on('shardError', (error, shardId) => logError('discordShardError', error, { shardId }));
  }
}

module.exports = {
  logError,
  registerErrorMonitor
};
