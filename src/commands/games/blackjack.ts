import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { GameEngine, Card } from '../../services/gameEngine.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Jouer une partie de Blackjack interactif contre le croupier William')
    .addIntegerOption((opt) => opt.setName('mise').setDescription('Montant à miser').setMinValue(1).setRequired(true)),
  category: 'games',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    const betRemoved = await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      `Mise au Blackjack`
    );

    if (!betRemoved) {
      await interaction.reply({
        embeds: [EmbedService.error('Solde insuffisant', `Vous n avez pas **${bet} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const deck = GameEngine.createDeck();
    const playerHand: Card[] = [deck.pop()!, deck.pop()!];
    const dealerHand: Card[] = [deck.pop()!, deck.pop()!];

    const formatHand = (hand: Card[], hideSecond = false) => {
      if (hideSecond) {
        return `${hand[0].value}${hand[0].suit} | 🂠 [Cachée]`;
      }
      return hand.map((c) => `${c.value}${c.suit}`).join(' ');
    };

    const renderEmbed = (statusTitle: string, isFinished = false, colorHex?: number) => {
      const playerScore = GameEngine.calculateHandScore(playerHand);
      const dealerScore = isFinished
        ? GameEngine.calculateHandScore(dealerHand)
        : GameEngine.calculateHandScore([dealerHand[0]]);

      const embed = EmbedService.create(statusTitle)
        .addFields(
          {
            name: `👤 Vos Cartes (Score: ${playerScore})`,
            value: formatHand(playerHand),
            inline: false,
          },
          {
            name: `🎴 Croupier (Score: ${isFinished ? dealerScore : '?'})`,
            value: formatHand(dealerHand, !isFinished),
            inline: false,
          }
        );

      if (colorHex) embed.setColor(colorHex);
      return embed;
    };

    const hitBtn = new ButtonBuilder().setCustomId('bj_hit').setLabel('Tirer 🃏').setStyle(ButtonStyle.Primary);
    const standBtn = new ButtonBuilder().setCustomId('bj_stand').setLabel('Rester 🛑').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(hitBtn, standBtn);

    const response = await interaction.reply({
      embeds: [renderEmbed('🃏 Blackjack — Votre Tour')],
      components: [row],
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (btnInt) => btnInt.user.id === interaction.user.id,
      time: 60000,
    });

    collector.on('collect', async (btnInt) => {
      if (btnInt.customId === 'bj_hit') {
        playerHand.push(deck.pop()!);
        const currentScore = GameEngine.calculateHandScore(playerHand);

        if (currentScore > 21) {
          collector.stop('bust');
          await btnInt.update({
            embeds: [
              renderEmbed('💥 Blackjack — DÉPASSEMENT (Bust !)', true, 0xE74C3C).setDescription(
                `Vous avez dépassé 21 ! Vous perdez votre mise de **${bet} ${currency}**.`
              ),
            ],
            components: [],
          });
        } else {
          await btnInt.update({
            embeds: [renderEmbed('🃏 Blackjack — Votre Tour')],
            components: [row],
          });
        }
      } else if (btnInt.customId === 'bj_stand') {
        collector.stop('stand');
        // Dealer plays (hits under 17)
        let dealerScore = GameEngine.calculateHandScore(dealerHand);
        while (dealerScore < 17) {
          dealerHand.push(deck.pop()!);
          dealerScore = GameEngine.calculateHandScore(dealerHand);
        }

        const playerScore = GameEngine.calculateHandScore(playerHand);

        if (dealerScore > 21 || playerScore > dealerScore) {
          const winnings = bet * 2;
          await EconomyService.addBalance(
            interaction.guild!.id,
            interaction.user.id,
            winnings,
            'GAME_WIN',
            `Gains Blackjack (+${winnings})`
          );

          await btnInt.update({
            embeds: [
              renderEmbed('🎉 Blackjack — VICTOIRE !', true, 0x2ECC71).setDescription(
                `Félicitations ! Vous remportez **+${winnings} ${currency}** !`
              ),
            ],
            components: [],
          });
        } else if (playerScore === dealerScore) {
          await EconomyService.addBalance(
            interaction.guild!.id,
            interaction.user.id,
            bet,
            'GAME_WIN',
            `Remboursement Égalité Blackjack`
          );

          await btnInt.update({
            embeds: [
              renderEmbed('🤝 Blackjack — ÉGALITÉ', true, 0xD4AF37).setDescription(
                `Égalité parfaite. Votre mise de **${bet} ${currency}** est remboursée.`
              ),
            ],
            components: [],
          });
        } else {
          await btnInt.update({
            embeds: [
              renderEmbed('💔 Blackjack — DÉFAITE', true, 0xE74C3C).setDescription(
                `Le croupier gagne avec un meilleur score. Vous perdez **${bet} ${currency}**.`
              ),
            ],
            components: [],
          });
        }
      }
    });
  },
};

export default command;
