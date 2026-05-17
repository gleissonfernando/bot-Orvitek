const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { createProduct, listProducts, removeProduct } = require('../lib/store');
const { money } = require('../lib/format');
const { requireAdmin } = require('../lib/permissions');
const { privateReply } = require('../lib/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('produto')
    .setDescription('Gerencia produtos vendidos pelo servidor.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('criar')
        .setDescription('Cadastra um novo produto.')
        .addStringOption((option) =>
          option.setName('nome').setDescription('Nome do bot ou servico.').setRequired(true)
        )
        .addNumberOption((option) =>
          option.setName('preco').setDescription('Preco em reais.').setRequired(true).setMinValue(0)
        )
        .addStringOption((option) =>
          option.setName('descricao').setDescription('Descricao do produto.').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('listar').setDescription('Lista produtos ativos.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remover')
        .setDescription('Remove um produto da lista ativa.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID do produto.').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== 'listar' && !(await requireAdmin(interaction))) {
      return;
    }

    if (subcommand === 'criar') {
      const product = createProduct({
        name: interaction.options.getString('nome', true),
        price: interaction.options.getNumber('preco', true),
        description: interaction.options.getString('descricao', true)
      });

      await interaction.reply(privateReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('Produto cadastrado')
            .addFields(
              { name: 'ID', value: String(product.id), inline: true },
              { name: 'Nome', value: product.name, inline: true },
              { name: 'Preco', value: money(product.price), inline: true },
              { name: 'Descricao', value: product.description }
            )
        ]
      }));
      return;
    }

    if (subcommand === 'listar') {
      const products = listProducts().filter((product) => product.active);

      if (products.length === 0) {
        await interaction.reply(privateReply('Nenhum produto ativo cadastrado.'));
        return;
      }

      await interaction.reply(privateReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('Produtos ativos')
            .setDescription(
              products
                .map((product) => `**#${product.id} - ${product.name}**\n${money(product.price)}\n${product.description}`)
                .join('\n\n')
            )
        ]
      }));
      return;
    }

    if (subcommand === 'remover') {
      const product = removeProduct(interaction.options.getInteger('id', true));

      if (!product) {
        await interaction.reply(privateReply('Produto nao encontrado.'));
        return;
      }

      await interaction.reply(privateReply(`Produto #${product.id} removido da lista ativa.`));
    }
  }
};
