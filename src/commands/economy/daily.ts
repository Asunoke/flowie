import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Réclamer votre récompense quotidienne de monnaie'),
  category: 'economy',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const res = await EconomyService.claimDaily(interaction.guild.id, interaction.user.id);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (!res.success && res.nextAvailableAt) {
      const timestamp = Math.floor(res.nextAvailableAt.getTime() / 1000);
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Récompense déjà réclamée',
            `Vous avez déjà récupéré votre récompense quotidienne aujourd hui. Revenez <t:${timestamp}:R>.`
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (res.result) {
      const embed = EmbedService.success(
        '🎁 Récompense Quotidienne !',
        `Vous avez reçu **+${res.result.amount} ${currency}** !\n\n🔥 **Série actuelle** : \`${res.result.streak} jour(s)\`\n✨ **Bonus de série** : \`+${res.result.bonus} ${currency}\``
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
