import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';
import { GameEngine } from '../../services/gameEngine.js';
import { redis } from '../../services/redisService.js';
import { config } from '../../config/index.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Jouer à la roulette européenne (rouge/noir/pair/impair ou numéro 0-36)')
    .addIntegerOption((opt) =>
      opt.setName('mise').setDescription('Montant de votre mise').setMinValue(1).setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('pari')
        .setDescription('Votre pari: rouge, noir, pair, impair ou un chiffre entre 0 et 36')
        .setRequired(true)
    ),
  category: 'games',
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const bet = interaction.options.getInteger('mise', true);
    const pariInput = interaction.options.getString('pari', true);

    const currency = await EconomyService.getCurrencyName(interaction.guild.id);
    const member = await EconomyService.getMember(interaction.guild.id, interaction.user.id);

    // Validate bet amount
    if (member.balance < bet) {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Fonds insuffisants',
            `Vous n'avez pas assez de **${currency}** dans votre portefeuille. Solde actuel : **${member.balance} ${currency}**.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate pari
    const validChoices = ['rouge', 'noir', 'pair', 'impair'];
    const parsedNum = parseInt(pariInput.trim(), 10);
    const isValidNum = !isNaN(parsedNum) && parsedNum >= 0 && parsedNum <= 36;
    const isValidChoice = validChoices.includes(pariInput.trim().toLowerCase()) || isValidNum;

    if (!isValidChoice) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Pari invalide',
            'Veuillez choisir parmi : `rouge`, `noir`, `pair`, `impair` ou un chiffre entre `0` et `36`.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Idempotence lock via Redis
    const lockKey = `lock:roulette:${interaction.user.id}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 3);
    if (!acquired) {
      await interaction.reply({
        embeds: [EmbedService.warning('Patienter', 'Une partie est déjà en cours d\'exécution.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Play Roulette
    const { spunNumber, color, win, multiplier } = GameEngine.playRoulette(pariInput);

    if (win) {
      const payout = bet * multiplier;
      const netProfit = payout - bet;

      // Add net payout
      await EconomyService.addBalance(
        interaction.guild.id,
        interaction.user.id,
        netProfit,
        'GAME_WIN',
        `Roulette Gagnée (Pari: ${pariInput}, Numéro: ${spunNumber})`
      );

      await GameEngine.checkSuspiciousWin(
        interaction.guild.id,
        interaction.user.id,
        netProfit,
        'Roulette',
        interaction.guild
      );

      const embed = EmbedService.success(
        '🎡 Roulette — Victoire !',
        `La bille s'est arrêtée sur : **${spunNumber}** (${color})\n\n` +
          `🎯 Votre pari : \`${pariInput}\`\n` +
          `💰 Multiplicateur : \`x${multiplier}\`\n` +
          `🎉 Vous gagnez **+${netProfit} ${currency}** !`
      );
      await interaction.reply({ embeds: [embed] });
    } else {
      // Deduct bet
      await EconomyService.removeBalance(
        interaction.guild.id,
        interaction.user.id,
        bet,
        'GAME_LOSS',
        `Roulette Perdue (Pari: ${pariInput}, Numéro: ${spunNumber})`
      );

      const embed = EmbedService.error(
        '🎡 Roulette — Défaite',
        `La bille s'est arrêtée sur : **${spunNumber}** (${color})\n\n` +
          `🎯 Votre pari : \`${pariInput}\`\n` +
          `💸 Vous perdez votre mise de **-${bet} ${currency}**.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default command;
