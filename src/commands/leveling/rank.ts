import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { LevelingService } from '../../services/levelingService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Afficher votre carte de niveau (rank) ou celle d un autre membre')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre dont vous souhaitez voir le niveau').setRequired(false)
    ),
  category: 'leveling',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    await interaction.deferReply();

    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const { xp, level, rank } = await LevelingService.getUserRank(interaction.guild.id, targetUser.id);

    if (xp === 0 && rank === 0) {
      await interaction.editReply({
        embeds: [
          EmbedService.warning(
            'Aucune expérience',
            `${targetUser} n'a pas encore gagné d'expérience sur ce serveur.`
          ),
        ],
      });
      return;
    }

    const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
    const buffer = await LevelingService.generateRankCard(
      targetUser.username,
      avatarUrl,
      xp,
      level,
      rank
    );

    const attachment = new AttachmentBuilder(buffer, { name: 'rank-card.png' });
    await interaction.editReply({ files: [attachment] });
  },
};

export default command;
