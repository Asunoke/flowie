import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement des membres les plus riches du serveur'),
  category: 'economy',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const topMembers = await EconomyService.getLeaderboard(interaction.guild.id, 10);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (topMembers.length === 0) {
      await interaction.reply({
        embeds: [EmbedService.warning('Classement vide', 'Aucune donnée économique enregistrée.')],
      });
      return;
    }

    const embed = EmbedService.gold(
      `🏆 Classement de Richesse — ${interaction.guild.name}`,
      `Top 10 des fortune du serveur (${currency})`
    );

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    for (let i = 0; i < topMembers.length; i++) {
      const m = topMembers[i];
      const total = m.balance + m.bankBalance;
      const rank = medals[i] || `#${i + 1}`;
      embed.addFields({
        name: `${rank} — <@${m.userId}>`,
        value: `💰 Total : **${total} ${currency}** *(Portefeuille: ${m.balance} | Banque: ${m.bankBalance})*`,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
