import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Lancer la machine à sous Flowie')
    .addIntegerOption((opt) => opt.setName('mise').setDescription('Montant à miser').setMinValue(1).setRequired(true)),
  category: 'games',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    const betRemoved = await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      `Mise à la Machine à sous`
    );

    if (!betRemoved) {
      await interaction.reply({
        embeds: [EmbedService.error('Solde insuffisant', `Vous n avez pas **${bet} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const { reels, win, multiplier } = GameEngine.playSlots();
    const reelsDisplay = `[ ${reels[0]} | ${reels[1]} | ${reels[2]} ]`;

    if (win) {
      const winnings = Math.floor(bet * multiplier);
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        winnings,
        'GAME_WIN',
        `Gains Machine à sous (+${winnings})`
      );

      const embed = EmbedService.success(
        '🎰 Machine à sous — GAGNÉ !',
        `🎰 **Résultat** : ${reelsDisplay}\n\n🎉 Multiplicateur **x${multiplier}** !\nVous remportez **+${winnings} ${currency}** !`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      const embed = EmbedService.error(
        '🎰 Machine à sous — PERDU',
        `🎰 **Résultat** : ${reelsDisplay}\n\nVous perdez votre mise de **${bet} ${currency}**.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
