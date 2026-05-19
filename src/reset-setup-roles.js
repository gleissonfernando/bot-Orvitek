require('./lib/loadEnv');

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { roleSpecs } = require('./config/setup');
const { getGuildSetup, saveGuildSetup } = require('./lib/store');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();

  const setup = getGuildSetup(guild.id) || {};
  const currentRoles = setup.roles || {};
  const rolesBySpec = new Map(roleSpecs.map((spec) => [spec.key, new Map()]));

  for (const spec of roleSpecs) {
    const savedRole = currentRoles[spec.key] ? guild.roles.cache.get(currentRoles[spec.key]) : null;
    if (savedRole) rolesBySpec.get(spec.key).set(savedRole.id, savedRole);

    for (const role of guild.roles.cache.values()) {
      if (normalizeName(role.name) === normalizeName(spec.name)) {
        rolesBySpec.get(spec.key).set(role.id, role);
      }
    }
  }

  const deleted = [];
  const failedDelete = [];
  const kept = {};

  for (const spec of roleSpecs) {
    for (const role of rolesBySpec.get(spec.key).values()) {
      if (role.managed || role.id === guild.id) continue;

      try {
        await role.delete('SetupBot resetando cargos');
        deleted.push(role.name);
      } catch (error) {
        kept[spec.key] = role.id;
        failedDelete.push(`${role.name}: ${error.message}`);
      }
    }
  }

  await guild.roles.fetch();

  const roles = {};
  const created = [];
  const failedCreate = [];

  for (const spec of roleSpecs) {
    if (kept[spec.key]) {
      roles[spec.key] = kept[spec.key];
      continue;
    }

    try {
      const role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        permissions: spec.permissions,
        reason: 'SetupBot recriando cargos'
      });
      roles[spec.key] = role.id;
      created.push(role.name);
    } catch (error) {
      failedCreate.push(`${spec.name}: ${error.message}`);
    }
  }

  saveGuildSetup(guild.id, {
    ...setup,
    roles
  });

  console.log(`Cargos apagados: ${deleted.length}`);
  for (const name of deleted) console.log(`- ${name}`);

  if (failedDelete.length) {
    console.log(`Falhas ao apagar: ${failedDelete.length}`);
    for (const item of failedDelete) console.log(`- ${item}`);
  }

  console.log(`Cargos criados: ${created.length}`);
  for (const name of created) console.log(`- ${name}`);

  if (failedCreate.length) {
    console.log(`Falhas ao criar: ${failedCreate.length}`);
    for (const item of failedCreate) console.log(`- ${item}`);
  }

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
