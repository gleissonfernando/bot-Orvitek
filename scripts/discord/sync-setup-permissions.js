require('dotenv').config();

const { Client, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { categories, staffRoleKeys } = require('../../src/config/setup');
const { getGuildSetup } = require('../../src/lib/store');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function rolePermissions(roleIds, roleKeys, allowSend = true) {
  return roleKeys
    .filter((key) => roleIds[key])
    .map((key) => ({
      id: roleIds[key],
      allow: allowSend
        ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
    }));
}

function channelOverwrites(guild, roleIds, spec) {
  const overwrites = [];

  if (spec.denyEveryone) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    });
  } else if (spec.everyone) {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: spec.readOnly ? [PermissionFlagsBits.SendMessages] : []
    });
  }

  if (spec.roleKeys) {
    overwrites.push(...rolePermissions(roleIds, spec.roleKeys, !spec.readOnly));
  }

  for (const key of staffRoleKeys) {
    if (roleIds[key]) {
      overwrites.push({
        id: roleIds[key],
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }
  }

  return overwrites;
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const setup = getGuildSetup(guild.id);
  if (!setup?.roles || !setup?.channels) {
    throw new Error('Setup sem cargos/canais salvos. Execute /ativar ou sync-setup-roles primeiro.');
  }

  const updated = [];
  const failed = [];

  for (const categorySpec of categories) {
    for (const channelSpec of categorySpec.channels) {
      const channelId = setup.channels[channelSpec.key];
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      if (!channel?.isTextBased()) continue;

      try {
        await channel.permissionOverwrites.set(
          channelOverwrites(guild, setup.roles, channelSpec),
          'SetupBot sincronizando permissões dos cargos'
        );
        updated.push(channel.name);
      } catch (error) {
        failed.push(`${channel.name || channelId}: ${error.message}`);
      }
    }
  }

  console.log(`Canais atualizados: ${updated.length}`);
  for (const name of updated) console.log(`- ${name}`);

  if (failed.length) {
    console.log(`Falhas ao atualizar: ${failed.length}`);
    for (const item of failed) console.log(`- ${item}`);
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
