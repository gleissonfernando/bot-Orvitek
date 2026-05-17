const { MessageFlags } = require('discord.js');

function privateReply(payload) {
  if (typeof payload === 'string') {
    return {
      content: payload,
      flags: MessageFlags.Ephemeral
    };
  }

  return {
    ...payload,
    flags: MessageFlags.Ephemeral
  };
}

module.exports = {
  privateReply
};
