import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Définir le rôle attribué aux nouveaux arrivants')
    .addRoleOption((opt) => opt.setName('role').setDescription('Rôle à attribuer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  category: 'management',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const role = interaction.options.getRole('role', true);

    await prisma.guild.upsert({
      where: { id: interaction.guild.id },
      create: { id: interaction.guild.id, autoRoleId: role.id },
      update: { autoRoleId: role.id },
    });

    const embed = EmbedService.success(
      'Auto-Rôle mis à jour',
      `Les nouveaux membres recevront désormais automatiquement le rôle ${role}.`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
