const { PermissionFlagsBits } = require('discord.js');
const { privateReply } = require('./replies');
const { getGuildSetup } = require('./store');
const { roleSpecs, staffRoleKeys } = require('../config/setup');

function findConfiguredRole(member, key) {
  const setup = getGuildSetup(member.guild.id);
  const roleId = setup?.roles?.[key];
  if (roleId && member.roles.cache.has(roleId)) {
    return true;
  }

  const spec = roleSpecs.find((role) => role.key === key);
  return Boolean(spec && member.roles.cache.some((role) => role.name === spec.name));
}

function isAdmin(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;

  if (adminRoleId && member.roles.cache.has(adminRoleId)) {
    return true;
  }

  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function isStaff(member) {
  if (isAdmin(member)) {
    return true;
  }

  return staffRoleKeys.some((key) => findConfiguredRole(member, key));
}

function isOwnerRole(member) {
  if (!member) {
    return false;
  }

  if (process.env.OWNER_USER_ID && member.id === process.env.OWNER_USER_ID) {
    return true;
  }

  if (member.guild?.ownerId && member.id === member.guild.ownerId) {
    return true;
  }

  const configuredOwnerRoleId = process.env.OWNER_ROLE_ID;

  if (configuredOwnerRoleId) {
    return member.roles.cache.has(configuredOwnerRoleId);
  }

  if (findConfiguredRole(member, 'owner')) {
    return true;
  }

  return member.roles.cache.some((role) => role.name === 'Dono');
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction.member)) {
    return true;
  }

  await interaction.reply(privateReply('Voce nao tem permissao para usar este comando.'));

  return false;
}

module.exports = {
  isAdmin,
  isOwnerRole,
  isStaff,
  requireAdmin
};
