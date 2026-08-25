import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { redis } from '../../services/redisService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('higher-lower')
    .setDescription('Pariez si la prochaine carte sera plus haute ou plus basse !')
    .addIntegerOption((opt) =>
      opt.setName('mise').setDescription('Montant de votre mise').setMinValue(1).setRequired(true)
    ),
  category: 'games',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);
    const member = await EconomyService.getMember(interaction.guild.id, interaction.user.id);

    if (member.balance < bet) {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Fonds insuffisants',
            `Vous n'avez pas assez de **${currency}** dans votre portefeuille (Solde : **${member.balance} ${currency}**).`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Idempotence lock via Redis
    const lockKey = `lock:hl:${interaction.user.id}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 10);
    if (!acquired) {
      await interaction.reply({
        embeds: [EmbedService.warning('Partie active', 'Vous avez déjà une partie en cours.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Deduct initial bet
    await EconomyService.removeBalance(
      interaction.guild.id,
      interaction.user.id,
      bet,
      'GAME_LOSS',
      'Mise Higher-Lower'
    );

    let currentCardValue = Math.floor(Math.random() * 13) + 1; // 1 (Ace) to 13 (King)
    let currentMultiplier = 1.0;
    let roundCount = 0;

    const cardNames = ['', 'As (1)', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Valet (11)', 'Dame (12)', 'Roi (13)'];

    const buildEmbed = (messageText: string) => {
      const potentialPayout = Math.floor(bet * currentMultiplier);
      return EmbedService.gold(
        '🃏 Higher or Lower',
        messageText
      ).addFields(
        { name: '🎴 Carte actuelle', value: `**${cardNames[currentCardValue]}**`, inline: true },
        { name: '📈 Multiplicateur actuel', value: `\`x${currentMultiplier.toFixed(1)}\``, inline: true },
        { name: '💰 Gain potentiel', value: `**${potentialPayout} ${currency}**`, inline: true }
      );
    };

    const getButtons = (disabled = false) => {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('hl_higher')
          .setLabel('Plus haut ⬆️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('hl_lower')
          .setLabel('Plus bas ⬇️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('hl_cashout')
          .setLabel(`Encaisser (${Math.floor(bet * currentMultiplier)} ${currency}) 💰`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled || roundCount === 0)
      );
    };

    const replyMessage = await interaction.reply({
      embeds: [buildEmbed('Devinez si la prochaine carte sera plus haute ou plus basse !')],
      components: [getButtons()],
      fetchReply: true,
    });

    const collector = replyMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (btnInteraction) => {
      await btnInteraction.deferUpdate();

      if (btnInteraction.customId === 'hl_cashout') {
        const finalPayout = Math.floor(bet * currentMultiplier);
        const netProfit = finalPayout - bet;

        if (netProfit > 0) {
          await EconomyService.addBalance(
            interaction.guild!.id,
            interaction.user.id,
            finalPayout,
            'GAME_WIN',
            `Gain Higher-Lower (x${currentMultiplier.toFixed(1)})`
          );

          await GameEngine.checkSuspiciousWin(
            interaction.guild!.id,
            interaction.user.id,
            netProfit,
            'Higher-Lower',
            interaction.guild
          );
        } else {
          // Refund exact bet
          await EconomyService.addBalance(
            interaction.guild!.id,
            interaction.user.id,
            bet,
            'GAME_WIN',
            'Remboursement Higher-Lower'
          );
        }

        await redis.del(lockKey);
        collector.stop('cashout');

        const winEmbed = EmbedService.success(
          '💰 Encaissé !',
          `Vous avez encaissé **${finalPayout} ${currency}** avec un multiplicateur de **x${currentMultiplier.toFixed(1)}** !`
        );
        await replyMessage.edit({ embeds: [winEmbed], components: [getButtons(true)] });
        return;
      }

      // Draw next card
      const nextCardValue = Math.floor(Math.random() * 13) + 1;
      const isHigher = btnInteraction.customId === 'hl_higher';
      let correct = false;

      if (isHigher) {
        correct = nextCardValue >= currentCardValue;
      } else {
        correct = nextCardValue <= currentCardValue;
      }

      if (correct) {
        roundCount++;
        currentMultiplier += 0.4; // +0.4x per step
        currentCardValue = nextCardValue;

        await replyMessage.edit({
          embeds: [buildEmbed(`✅ Bien joué ! La nouvelle carte est **${cardNames[nextCardValue]}**.`)],
          components: [getButtons()],
        });
      } else {
        // Lost!
        await redis.del(lockKey);
        collector.stop('lost');

        const lostEmbed = EmbedService.error(
          '💥 Perdu !',
          `La nouvelle carte était **${cardNames[nextCardValue]}**.\nVous avez perdu votre mise de **-${bet} ${currency}**.`
        );
        await replyMessage.edit({ embeds: [lostEmbed], components: [getButtons(true)] });
      }
    });

    collector.on('end', async (_, reason) => {
      await redis.del(lockKey);
      if (reason === 'time') {
        const timeoutEmbed = EmbedService.warning(
          '⏰ Temps écoulé',
          `La partie est terminée par inactivité. Votre mise de **${bet} ${currency}** est conservée.`
        );
        await replyMessage.edit({ embeds: [timeoutEmbed], components: [getButtons(true)] }).catch(() => null);
      }
    });
  },
};

export default command;
