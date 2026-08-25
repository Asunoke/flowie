import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Travailler pour gagner régulièrement de la monnaie'),
  category: 'economy',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const res = await EconomyService.doWork(interaction.guild.id, interaction.user.id);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (!res.success && res.cooldownRemainingSec) {
      const minutes = Math.floor(res.cooldownRemainingSec / 60);
      const seconds = res.cooldownRemainingSec % 60;
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'En pause de travail',
            `Vous devez vous reposer ! Vous pourrez travailler de nouveau dans \`${minutes}m ${seconds}s\`.`
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (res.amount && res.jobName) {
      const embed = EmbedService.success(
        '💼 Travail Accompli',
        `**Metier** : ${res.jobName}\n**Salaire perçu** : **+${res.amount} ${currency}**`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
