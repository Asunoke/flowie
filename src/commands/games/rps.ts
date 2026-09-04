import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Jouer à Pierre-Feuille-Ciseaux contre le bot')
    .addIntegerOption((opt) => opt.setName('mise').setDescription('Montant à miser').setMinValue(1).setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('choix')
        .setDescription('Votre choix')
        .setRequired(true)
        .addChoices(
          { name: '🪨 Pierre', value: 'pierre' },
          { name: '📄 Papier', value: 'papier' },
          { name: '✂️ Ciseaux', value: 'ciseaux' }
        )
    ),
  category: 'games',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const userChoice = interaction.options.getString('choix', true) as 'pierre' | 'papier' | 'ciseaux';
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    const betRemoved = await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      `Mise au Pierre-Feuille-Ciseaux`
    );

    if (!betRemoved) {
      await interaction.reply({
        embeds: [EmbedService.error('Solde insuffisant', `Vous n avez pas **${bet} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const { botChoice, result } = GameEngine.playRPS(userChoice);

    const emojis: Record<string, string> = {
      pierre: '🪨 Pierre',
      papier: '📄 Papier',
      ciseaux: '✂️ Ciseaux',
    };

    if (result === 'WIN') {
      const winnings = bet * 2;
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        winnings,
        'GAME_WIN',
        `Gains Pierre-Feuille-Ciseaux (+${winnings})`
      );

      const embed = EmbedService.success(
        '✂️ Pierre-Feuille-Ciseaux — VICTOIRE !',
        `Vous : **${emojis[userChoice]}**\nWilliam : **${emojis[botChoice]}**\n\n🎉 Vous remportez **+${winnings} ${currency}** !`
      );
      await interaction.reply({ embeds: [embed] });
    } else if (result === 'DRAW') {
      // Refund bet
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        bet,
        'GAME_WIN',
        `Remboursement Égalité RPS`
      );

      const embed = EmbedService.gold(
        '✂️ Pierre-Feuille-Ciseaux — ÉGALITÉ',
        `Vous : **${emojis[userChoice]}**\nWilliam : **${emojis[botChoice]}**\n\n🤝 Votre mise de **${bet} ${currency}** vous a été remboursée.`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      const embed = EmbedService.error(
        '✂️ Pierre-Feuille-Ciseaux — DÉFAITE',
        `Vous : **${emojis[userChoice]}**\nWilliam : **${emojis[botChoice]}**\n\nVous perdez votre mise de **${bet} ${currency}**.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
