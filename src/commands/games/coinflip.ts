import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Lancer une pièce de monnaie (Pile ou Face) et doubler votre mise')
    .addIntegerOption((opt) => opt.setName('mise').setDescription('Montant à miser').setMinValue(1).setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('choix')
        .setDescription('Votre prédiction')
        .setRequired(true)
        .addChoices({ name: 'Pile 🪙', value: 'pile' }, { name: 'Face 🪙', value: 'face' })
    ),
  category: 'games',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const choice = interaction.options.getString('choix', true) as 'pile' | 'face';
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    // Verify balance & remove bet
    const betRemoved = await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      `Mise au Coinflip`
    );

    if (!betRemoved) {
      await interaction.reply({
        embeds: [EmbedService.error('Solde insuffisant', `Vous n avez pas **${bet} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const { outcome, win } = GameEngine.playCoinflip(choice);

    if (win) {
      const winnings = bet * 2;
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        winnings,
        'GAME_WIN',
        `Gains au Coinflip (+${winnings})`
      );

      const embed = EmbedService.success(
        '🪙 Coinflip — VICTOIRE !',
        `La pièce est tombée sur **${outcome.toUpperCase()}** !\n\n🎉 Vous remportez **+${winnings} ${currency}** !`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      const embed = EmbedService.error(
        '🪙 Coinflip — DÉFAITE',
        `La pièce est tombée sur **${outcome.toUpperCase()}**.\n\nVous perdez votre mise de **${bet} ${currency}**.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
