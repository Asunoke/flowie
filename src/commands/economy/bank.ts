import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Gérer vos dépôts et retraits bancaires')
    .addSubcommand((sub) =>
      sub
        .setName('deposit')
        .setDescription('Déposer de l argent dans la banque')
        .addIntegerOption((opt) => opt.setName('montant').setDescription('Montant à déposer').setMinValue(1).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('withdraw')
        .setDescription('Retirer de l argent de la banque')
        .addIntegerOption((opt) => opt.setName('montant').setDescription('Montant à retirer').setMinValue(1).setRequired(true))
    ),
  category: 'economy',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const amount = interaction.options.getInteger('montant', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (subcommand === 'deposit') {
      const success = await EconomyService.depositBank(interaction.guild.id, interaction.user.id, amount);
      if (!success) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', `Fonds insuffisants en portefeuille pour déposer **${amount} ${currency}**.`)],
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [EmbedService.success('Dépôt réussi', `Vous avez déposé **${amount} ${currency}** dans votre compte bancaire.`)],
      });
      return;
    }

    if (subcommand === 'withdraw') {
      const success = await EconomyService.withdrawBank(interaction.guild.id, interaction.user.id, amount);
      if (!success) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur', `Fonds bancaires insuffisants pour retirer **${amount} ${currency}**.`)],
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [EmbedService.success('Retrait réussi', `Vous avez retiré **${amount} ${currency}** de votre compte bancaire.`)],
      });
      return;
    }
  },
};

export default command;
