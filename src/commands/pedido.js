const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { createOrder, findProduct, listOrders, updateOrderStatus } = require('../lib/store');
const { money, shortDate } = require('../lib/format');
const { requireAdmin } = require('../lib/permissions');
const { privateReply } = require('../lib/replies');
const { toComponentsV2 } = require('../lib/componentsV2');

const statuses = ['pendente', 'pago', 'entregue', 'cancelado'];

function statusChoices(option) {
  return option.addChoices(...statuses.map((status) => ({ name: status, value: status })));
}

async function sendSalesLog(client, order, title) {
  const channelId = process.env.SALES_LOG_CHANNEL_ID;

  if (!channelId) {
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return;
  }

  await channel.send(toComponentsV2({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(title)
        .addFields(
          { name: 'Pedido', value: `#${order.id}`, inline: true },
          { name: 'Cliente', value: `<@${order.customerId}>`, inline: true },
          { name: 'Produto', value: order.productName, inline: true },
          { name: 'Valor', value: money(order.amount), inline: true },
          { name: 'Status', value: order.status, inline: true }
        )
    ]
  }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pedido')
    .setDescription('Gerencia pedidos de venda.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('criar')
        .setDescription('Cria um pedido para um cliente.')
        .addUserOption((option) =>
          option.setName('cliente').setDescription('Cliente do pedido.').setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('produto_id').setDescription('ID do produto.').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
          option.setName('observacao').setDescription('Observacao interna.').setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('listar')
        .setDescription('Lista pedidos.')
        .addStringOption((option) =>
          statusChoices(option.setName('status').setDescription('Filtrar por status.').setRequired(false))
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Atualiza o status de um pedido.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID do pedido.').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
          statusChoices(option.setName('status').setDescription('Novo status.').setRequired(true))
        )
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'criar') {
      const productId = interaction.options.getInteger('produto_id', true);
      const product = findProduct(productId);

      if (!product) {
        await interaction.reply(privateReply('Produto ativo nao encontrado.'));
        return;
      }

      const customer = interaction.options.getUser('cliente', true);
      const order = createOrder({
        customerId: customer.id,
        customerTag: customer.tag,
        product,
        notes: interaction.options.getString('observacao') || '',
        sellerId: interaction.user.id,
        sellerTag: interaction.user.tag
      });

      await sendSalesLog(interaction.client, order, 'Novo pedido criado');

      await interaction.reply(privateReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('Pedido criado')
            .addFields(
              { name: 'Pedido', value: `#${order.id}`, inline: true },
              { name: 'Cliente', value: `<@${order.customerId}>`, inline: true },
              { name: 'Produto', value: order.productName, inline: true },
              { name: 'Valor', value: money(order.amount), inline: true },
              { name: 'Status', value: order.status, inline: true }
            )
        ]
      }));
      return;
    }

    if (subcommand === 'listar') {
      const status = interaction.options.getString('status');
      const orders = listOrders(status).slice(-15).reverse();

      if (orders.length === 0) {
        await interaction.reply(privateReply('Nenhum pedido encontrado.'));
        return;
      }

      await interaction.reply(privateReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(status ? `Pedidos: ${status}` : 'Pedidos recentes')
            .setDescription(
              orders
                .map((order) =>
                  `**#${order.id} - ${order.status}**\nCliente: <@${order.customerId}>\nProduto: ${order.productName} (${money(order.amount)})\nCriado: ${shortDate(order.createdAt)}`
                )
                .join('\n\n')
            )
        ]
      }));
      return;
    }

    if (subcommand === 'status') {
      const order = updateOrderStatus(
        interaction.options.getInteger('id', true),
        interaction.options.getString('status', true)
      );

      if (!order) {
        await interaction.reply(privateReply('Pedido nao encontrado.'));
        return;
      }

      await sendSalesLog(interaction.client, order, 'Status do pedido atualizado');
      await interaction.reply(privateReply(`Pedido #${order.id} atualizado para ${order.status}.`));
    }
  }
};
