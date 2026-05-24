require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { roleSpecs } = require('../../src/config/setup');
const { getGuildSetup, saveGuildSetup } = require('../../src/lib/store');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  throw new Error('Configure DISCORD_TOKEN e GUILD_ID no .env.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();

  const setup = getGuildSetup(guild.id) || {};
  const roles = { ...(setup.roles || {}) };
  const created = [];
  const found = [];

  for (const spec of roleSpecs) {
    let role = roles[spec.key] ? guild.roles.cache.get(roles[spec.key]) : null;
    if (!role) {
      role = guild.roles.cache.find((item) => item.name === spec.name);
    }
    if (!role) {
      role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        permissions: spec.permissions,
        reason: 'SetupBot sincronizando cargos'
      });
      created.push(role.name);
    } else {
      found.push(role.name);
    }
    roles[spec.key] = role.id;
  }

  saveGuildSetup(guild.id, {
    ...setup,
    roles
  });

  console.log(`Cargos criados: ${created.length}`);
  for (const name of created) console.log(`- ${name}`);
  console.log(`Cargos encontrados: ${found.length}`);

  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
