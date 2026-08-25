import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Lancer un dé à 6 faces et multiplier par 5 votre mise')
    .addIntegerOption((opt) => opt.setName('mise').setDescription('Montant à miser').setMinValue(1).setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('prediction').setDescription('Chiffre prédit (1 à 6)').setMinValue(1).setMaxValue(6).setRequired(true)
    ),
  category: 'games',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const prediction = interaction.options.getInteger('prediction', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    const betRemoved = await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      `Mise au Jeu de Dé`
    );

    if (!betRemoved) {
      await interaction.reply({
        embeds: [EmbedService.error('Solde insuffisant', `Vous n avez pas **${bet} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const { rolledNumber, win, multiplier } = GameEngine.playDice(prediction);

    if (win) {
      const winnings = bet * multiplier;
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        winnings,
        'GAME_WIN',
        `Gains au Dé x5 (+${winnings})`
      );

      const embed = EmbedService.success(
        '🎲 Jeu de Dé — JACKPOT !',
        `Le dé a fait un **${rolledNumber}** !\n\n🎉 Vous aviez prédit **${prediction}** ! Vous gagnez **+${winnings} ${currency}** (x5) !`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      const embed = EmbedService.error(
        '🎲 Jeu de Dé — Perdu',
        `Le dé a fait un **${rolledNumber}** (Votre prédiction: **${prediction}**).\n\nVous perdez votre mise de **${bet} ${currency}**.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
