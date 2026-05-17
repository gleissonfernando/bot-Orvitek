const { PermissionFlagsBits } = require('discord.js');
const { privateReply } = require('./replies');
const { getGuildSetup } = require('./store');
const { staffRoleKeys } = require('../config/setup');

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

  const setup = getGuildSetup(member.guild.id);
  if (!setup?.roles) {
    return false;
  }

  return staffRoleKeys.some((key) => {
    const roleId = setup.roles[key];
    return roleId && member.roles.cache.has(roleId);
  });
}

function isOwnerRole(member) {
  const configuredOwnerRoleId = process.env.OWNER_ROLE_ID;

  if (configuredOwnerRoleId) {
    return member.roles.cache.has(configuredOwnerRoleId);
  }

  const setup = getGuildSetup(member.guild.id);
  const ownerRoleId = setup?.roles?.owner;

  if (ownerRoleId && member.roles.cache.has(ownerRoleId)) {
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
