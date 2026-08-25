import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { redis } from '../../services/redisService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Défier un autre membre en duel 1v1 avec mise en jeu !')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à défier').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('mise').setDescription('Montant de la mise par joueur').setMinValue(1).setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('jeu')
        .setDescription('Type de jeu pour le duel (défaut: Coinflip)')
        .addChoices(
          { name: '🪙 Pile ou Face (Coinflip)', value: 'coinflip' },
          { name: '🎲 Lancer de Dés (Dice)', value: 'dice' }
        )
    ),
  category: 'games',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const bet = interaction.options.getInteger('mise', true);
    const gameType = interaction.options.getString('jeu') || 'coinflip';

    const challenger = interaction.user;
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    // Rejections
    if (targetUser.id === challenger.id) {
      await interaction.reply({
        embeds: [EmbedService.warning('Action impossible', 'Vous ne pouvez pas vous défier vous-même !')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (targetUser.bot) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Vous ne pouvez pas défier un bot.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check balances
    const challengerMember = await EconomyService.getMember(interaction.guild.id, challenger.id);
    if (challengerMember.balance < bet) {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Fonds insuffisants',
            `Vous n'avez pas assez de **${currency}** dans votre portefeuille. Solde : **${challengerMember.balance} ${currency}**.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMember = await EconomyService.getMember(interaction.guild.id, targetUser.id);
    if (targetMember.balance < bet) {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Adversaire insolvable',
            `${targetUser} n'a pas assez de **${currency}** pour accepter ce duel de **${bet} ${currency}**.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Escrow lock: deduct bet upfront from challenger
    const deductedChallenger = await EconomyService.removeBalance(
      interaction.guild.id,
      challenger.id,
      bet,
      'DUEL_ESCROW',
      `Mise bloquée en attente de duel contre <@${targetUser.id}>`
    );

    if (!deductedChallenger) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Impossible de bloquer la mise en réserve.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Challenge Embed & Buttons
    const gameLabel = gameType === 'coinflip' ? '🪙 Pile ou Face' : '🎲 Lancer de Dés';
    const embed = EmbedService.gold(
      '⚔️ Défi en Duel !',
      `${challenger} défie ${targetUser} en duel !`
    ).addFields(
      { name: '🎯 Jeu', value: `\`${gameLabel}\``, inline: true },
      { name: '💰 Mise par joueur', value: `**${bet} ${currency}**`, inline: true },
      { name: '🏆 Gain total', value: `**${bet * 2} ${currency}**`, inline: true }
    ).setFooter({ text: 'Le provoqué a 60 secondes pour accepter ou refuser.' });

    const getButtons = (disabled = false) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('duel_accept')
          .setLabel('Accepter ⚔️')
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('duel_refuse')
          .setLabel('Refuser ❌')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      );

    const reply = await interaction.reply({
      content: `${targetUser}`,
      embeds: [embed],
      components: [getButtons()],
      fetchReply: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
    });

    let handled = false;

    collector.on('collect', async (btnInteraction) => {
      // Only targetUser can click accept or refuse
      if (btnInteraction.user.id !== targetUser.id) {
        await btnInteraction.reply({
          embeds: [EmbedService.warning('Non concerné', 'Seul le membre défié peut répondre à cette invitation.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (handled) return;
      handled = true;
      collector.stop('handled');

      await btnInteraction.deferUpdate();

      if (btnInteraction.customId === 'duel_refuse') {
        // Refund challenger
        await EconomyService.addBalance(
          interaction.guild!.id,
          challenger.id,
          bet,
          'DUEL_REFUND',
          'Remboursement suite au refus du duel'
        );

        const cancelEmbed = EmbedService.error(
          '⚔️ Duel Refusé',
          `${targetUser} a refusé le duel. La mise de **${bet} ${currency}** a été remboursée à ${challenger}.`
        );
        await reply.edit({ embeds: [cancelEmbed], components: [getButtons(true)] });
        return;
      }

      if (btnInteraction.customId === 'duel_accept') {
        // Re-check target balance & deduct bet from target
        const deductedTarget = await EconomyService.removeBalance(
          interaction.guild!.id,
          targetUser.id,
          bet,
          'DUEL_ESCROW',
          `Mise de duel contre <@${challenger.id}>`
        );

        if (!deductedTarget) {
          // Refund challenger
          await EconomyService.addBalance(
            interaction.guild!.id,
            challenger.id,
            bet,
            'DUEL_REFUND',
            'Remboursement suite aux fonds insuffisants de l adversaire'
          );

          const errEmbed = EmbedService.error(
            'Duel Annulé',
            `${targetUser} ne possède plus les fonds nécessaires pour honorer le duel.`
          );
          await reply.edit({ embeds: [errEmbed], components: [getButtons(true)] });
          return;
        }

        // Execute Game
        let winnerId: string;
        let loserId: string;
        let resultDetail = '';

        if (gameType === 'coinflip') {
          const coinResult = GameEngine.playCoinflip('pile');
          const outcome = coinResult.outcome; // 'pile' or 'face'
          if (outcome === 'pile') {
            winnerId = challenger.id;
            loserId = targetUser.id;
          } else {
            winnerId = targetUser.id;
            loserId = challenger.id;
          }
          resultDetail = `La pièce est tombée sur **${outcome.toUpperCase()}** !`;
        } else {
          // Dice
          const rollChallenger = Math.floor(Math.random() * 6) + 1;
          const rollTarget = Math.floor(Math.random() * 6) + 1;

          if (rollChallenger >= rollTarget) {
            winnerId = challenger.id;
            loserId = targetUser.id;
          } else {
            winnerId = targetUser.id;
            loserId = challenger.id;
          }
          resultDetail = `${challenger} a fait **${rollChallenger}** 🎲 | ${targetUser} a fait **${rollTarget}** 🎲`;
        }

        const totalPrize = bet * 2;

        // Pay winner total prize
        await EconomyService.addBalance(
          interaction.guild!.id,
          winnerId,
          totalPrize,
          'DUEL_WIN',
          `Victoire en duel contre <@${loserId}>`
        );

        // Record loss for loser
        await EconomyService.addBalance(
          interaction.guild!.id,
          loserId,
          0,
          'DUEL_LOSS',
          `Défaite en duel contre <@${winnerId}>`
        );

        const winEmbed = EmbedService.success(
          '⚔️ Victoire en Duel !',
          `${resultDetail}\n\n🏆 **Vainqueur** : <@${winnerId}>\n💰 **Gain Total** : **+${totalPrize} ${currency}** !`
        );

        await reply.edit({ embeds: [winEmbed], components: [getButtons(true)] });
      }
    });

    collector.on('end', async (_, reason) => {
      if (!handled && reason === 'time') {
        // Refund challenger on timeout
        await EconomyService.addBalance(
          interaction.guild!.id,
          challenger.id,
          bet,
          'DUEL_REFUND',
          'Remboursement suite au délai dépassé'
        );

        const timeoutEmbed = EmbedService.warning(
          '⏰ Duel Expiré',
          `Le délai de 60 secondes est dépassé. Le duel est annulé et la mise de **${bet} ${currency}** a été remboursée à ${challenger}.`
        );

        await reply.edit({ embeds: [timeoutEmbed], components: [getButtons(true)] }).catch(() => null);
      }
    });
  },
};

export default command;
