const { MessageFlags } = require('discord.js');
const { toComponentsV2 } = require('./componentsV2');

function privateReply(payload) {
  if (typeof payload === 'string') {
    return toComponentsV2(payload, { ephemeral: true });
  }

  return toComponentsV2({
    ...payload,
    flags: MessageFlags.Ephemeral
  }, { ephemeral: true });
}

module.exports = {
  privateReply
};
