import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('level-roles')
    .setDescription('Gérer les rôles de récompense attribués automatiquement à certains niveaux')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ajouter un rôle de récompense pour un niveau')
        .addIntegerOption((opt) =>
          opt.setName('niveau').setDescription('Niveau requis').setMinValue(1).setRequired(true)
        )
        .addRoleOption((opt) => opt.setName('role').setDescription('Le rôle à attribuer').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Retirer un rôle de récompense pour un niveau')
        .addIntegerOption((opt) =>
          opt.setName('niveau').setDescription('Niveau requis').setMinValue(1).setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lister tous les rôles de récompense de niveau')
    ),
  category: 'leveling',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'add') {
      const level = interaction.options.getInteger('niveau', true);
      const role = interaction.options.getRole('role', true);

      await prisma.levelRole.upsert({
        where: { guildId_level: { guildId, level } },
        create: { guildId, level, roleId: role.id },
        update: { roleId: role.id },
      });

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Rôle de niveau configuré',
            `Les membres atteignant le **Niveau ${level}** recevront automatiquement le rôle ${role}.`
          ),
        ],
      });
      return;
    }

    if (subcommand === 'remove') {
      const level = interaction.options.getInteger('niveau', true);

      await prisma.levelRole.delete({
        where: { guildId_level: { guildId, level } },
      }).catch(() => null);

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Rôle de niveau supprimé',
            `Le rôle de récompense pour le **Niveau ${level}** a été supprimé.`
          ),
        ],
      });
      return;
    }

    if (subcommand === 'list') {
      const roles = await prisma.levelRole.findMany({
        where: { guildId },
        orderBy: { level: 'asc' },
      });

      const lines = roles.map((r: any) => `• **Niveau ${r.level}** ➔ <@&${r.roleId}>`);
      const embed = EmbedService.gold(
        `📜 Rôles de Récompense de Niveau (${roles.length})`,
        lines.length > 0 ? lines.join('\n') : '`Aucun rôle de récompense configuré`'
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
