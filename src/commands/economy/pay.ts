import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Envoyer de la monnaie à un autre membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Destinataire').setRequired(true))
    .addIntegerOption((opt) => opt.setName('montant').setDescription('Montant à transférer').setMinValue(1).setRequired(true)),
  category: 'economy',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    if (targetUser.id === interaction.user.id || targetUser.bot) {
      await interaction.reply({
        embeds: [EmbedService.error('Erreur', 'Vous ne pouvez pas vous transférer des fonds à vous-même ou à un bot.')],
        ephemeral: true,
      });
      return;
    }

    const success = await EconomyService.transfer(
      interaction.guild.id,
      interaction.user.id,
      targetUser.id,
      amount
    );

    if (!success) {
      await interaction.reply({
        embeds: [EmbedService.error('Fonds insuffisants', `Vous n avez pas **${amount} ${currency}** dans votre portefeuille.`)],
        ephemeral: true,
      });
      return;
    }

    const embed = EmbedService.success(
      '💸 Transfert Effectué',
      `Vous avez envoyé **${amount} ${currency}** à ${targetUser} !`
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
