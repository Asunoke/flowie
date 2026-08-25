import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Consulter les articles possédés dans votre inventaire')
    .addUserOption((opt) => opt.setName('membre').setDescription('Membre dont vous souhaitez voir l inventaire')),
  category: 'economy',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const member = await EconomyService.getMember(interaction.guild.id, targetUser.id);

    const items = await prisma.inventoryItem.findMany({
      where: { memberId: member.id },
      include: { shopItem: true },
    });

    if (items.length === 0) {
      await interaction.reply({
        embeds: [EmbedService.warning('Inventaire vide', `${targetUser.tag} n a aucun article dans son inventaire.`)],
      });
      return;
    }

    const embed = EmbedService.gold(`🎒 Inventaire — ${targetUser.tag}`, `Liste des objets et rôles débloqués`);

    items.forEach((inv: any, index: number) => {
      embed.addFields({
        name: `#${index + 1} — ${inv.shopItem.name}`,
        value: `${inv.shopItem.description}\n*Acheté le : ${new Date(inv.purchasedAt).toLocaleDateString('fr-FR')}*`,
      });
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
