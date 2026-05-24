const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getSummary } = require('../lib/store');
const { money } = require('../lib/format');
const { requireAdmin } = require('../lib/permissions');
const { privateReply } = require('../lib/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Mostra um resumo do sistema de vendas.'),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) {
      return;
    }

    const summary = getSummary();

    await interaction.reply(privateReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x1abc9c)
          .setTitle('Painel de vendas')
          .addFields(
            { name: 'Produtos ativos', value: String(summary.products), inline: true },
            { name: 'Pedidos', value: String(summary.orders), inline: true },
            { name: 'Faturamento', value: money(summary.revenue), inline: true },
            { name: 'Pendentes', value: String(summary.byStatus.pendente || 0), inline: true },
            { name: 'Pagos', value: String(summary.byStatus.pago || 0), inline: true },
            { name: 'Entregues', value: String(summary.byStatus.entregue || 0), inline: true },
            { name: 'Cancelados', value: String(summary.byStatus.cancelado || 0), inline: true }
          )
      ]
    }));
  }
};
