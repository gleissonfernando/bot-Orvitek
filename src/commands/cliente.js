const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { listCustomerOrders } = require('../lib/store');
const { money, shortDate } = require('../lib/format');
const { requireAdmin } = require('../lib/permissions');
const { privateReply } = require('../lib/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cliente')
    .setDescription('Consulta clientes.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ver')
        .setDescription('Mostra historico de pedidos de um cliente.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Usuario do Discord.').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) {
      return;
    }

    const user = interaction.options.getUser('usuario', true);
    const orders = listCustomerOrders(user.id);
    const total = orders
      .filter((order) => ['pago', 'entregue'].includes(order.status))
      .reduce((sum, order) => sum + order.amount, 0);

    await interaction.reply(privateReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`Cliente: ${user.tag}`)
          .addFields(
            { name: 'Pedidos', value: String(orders.length), inline: true },
            { name: 'Total pago', value: money(total), inline: true }
          )
          .setDescription(
            orders.length === 0
              ? 'Nenhum pedido encontrado para este cliente.'
              : orders
                  .slice(-10)
                  .reverse()
                  .map((order) => `**#${order.id} - ${order.status}**\n${order.productName} (${money(order.amount)})\n${shortDate(order.createdAt)}`)
                  .join('\n\n')
          )
      ]
    }));
  }
};
