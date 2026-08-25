import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Consulter son solde de portefeuille et de banque')
    .addUserOption((opt) => opt.setName('membre').setDescription('Membre dont vous souhaitez voir le solde')),
  category: 'economy',
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const member = await EconomyService.getMember(interaction.guild.id, targetUser.id);
    const currency = await EconomyService.getCurrencyName(interaction.guild.id);
    const total = member.balance + member.bankBalance;

    const embed = EmbedService.gold(
      `💰 Portefeuille — ${targetUser.tag}`,
      `Solde financier dans la monnaie **${currency}**`
    )
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '💵 Portefeuille', value: `\`${member.balance} ${currency}\``, inline: true },
        { name: '🏦 Banque', value: `\`${member.bankBalance} ${currency}\``, inline: true },
        { name: '💎 Total', value: `\`${total} ${currency}\``, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
