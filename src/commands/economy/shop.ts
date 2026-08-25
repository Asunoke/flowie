import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Boutique du serveur (achat de rôles et articles)')
    .addSubcommand((sub) => sub.setName('list').setDescription('Afficher les articles disponibles en boutique'))
    .addSubcommand((sub) =>
      sub
        .setName('buy')
        .setDescription('Acheter un article de la boutique par son ID')
        .addStringOption((opt) => opt.setName('item_id').setDescription('ID de l article').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ajouter un article en boutique (Admin)')
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom de l article').setRequired(true))
        .addIntegerOption((opt) => opt.setName('prix').setDescription('Prix de l article').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('description').setDescription('Description').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Rôle associé (optionnel)'))
    ),
  category: 'economy',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (subcommand === 'add') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          embeds: [EmbedService.error('Permission refusée', 'Seuls les administrateurs peuvent ajouter des articles.')],
          ephemeral: true,
        });
        return;
      }

      const name = interaction.options.getString('nom', true);
      const price = interaction.options.getInteger('prix', true);
      const description = interaction.options.getString('description', true);
      const role = interaction.options.getRole('role');

      const newItem = await prisma.shopItem.create({
        data: {
          guildId: interaction.guild.id,
          name,
          price,
          description,
          roleId: role ? role.id : null,
        },
      });

      const embed = EmbedService.success(
        'Article ajouté',
        `**ID** : \`${newItem.id}\`\n**Nom** : ${newItem.name}\n**Prix** : **${newItem.price} ${currency}**\n**Rôle** : ${role || 'Aucun'}`
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'list') {
      const items = await prisma.shopItem.findMany({
        where: { guildId: interaction.guild.id },
      });

      if (items.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.warning('Boutique vide', 'Aucun article n est disponible à la vente actuellement.')],
        });
        return;
      }

      const embed = EmbedService.gold(
        `🛍️ Boutique — ${interaction.guild.name}`,
        'Utilisez `/shop buy <item_id>` pour acheter un article'
      );

      items.forEach((item: any) => {
        embed.addFields({
          name: `📦 ${item.name} — ${item.price} ${currency} (ID: \`${item.id.slice(0, 8)}\`)`,
          value: `${item.description}${item.roleId ? `\n🎭 **Rôle octroyé** : <@&${item.roleId}>` : ''}`,
        });
      });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'buy') {
      const itemIdInput = interaction.options.getString('item_id', true);
      const items = await prisma.shopItem.findMany({
        where: { guildId: interaction.guild.id },
      });

      const item = items.find((i: any) => i.id === itemIdInput || i.id.startsWith(itemIdInput));

      if (!item) {
        await interaction.reply({
          embeds: [EmbedService.error('Article introuvable', `Aucun article ne correspond à l ID \`${itemIdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      // Check balance
      const member = await EconomyService.getMember(interaction.guild.id, interaction.user.id);
      if (member.balance < item.price) {
        await interaction.reply({
          embeds: [EmbedService.error('Fonds insuffisants', `Vous avez besoin de **${item.price} ${currency}** pour acheter ${item.name}.`)],
          ephemeral: true,
        });
        return;
      }

      // Process purchase
      await EconomyService.removeBalance(
        interaction.guild.id,
        interaction.user.id,
        item.price,
        'SHOP_BUY',
        `Achat d article : ${item.name}`
      );

      await prisma.inventoryItem.create({
        data: {
          memberId: member.id,
          shopItemId: item.id,
        },
      });

      // Grant role if applicable
      if (item.roleId) {
        const guildMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const role = interaction.guild.roles.cache.get(item.roleId);
        if (guildMember && role) {
          await guildMember.roles.add(role).catch(() => null);
        }
      }

      const embed = EmbedService.success(
        '🎉 Achat Réussi !',
        `Vous avez acheté **${item.name}** pour **${item.price} ${currency}** !`
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
