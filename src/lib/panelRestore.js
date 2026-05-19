const restoreSuppression = new Set();

function suppressPanelRestore(channelId, ttlMs = 10000) {
  if (!channelId) {
    return;
  }

  restoreSuppression.add(channelId);
  setTimeout(() => restoreSuppression.delete(channelId), ttlMs).unref?.();
}

function isPanelRestoreSuppressed(channelId) {
  return restoreSuppression.has(channelId);
}

module.exports = {
  isPanelRestoreSuppressed,
  suppressPanelRestore
};
