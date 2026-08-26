import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { CountingService } from '../../services/countingService.js';

const countingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('counting')
    .setDescription('Gérer le jeu du comptage (Counting Game)')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Définir le salon dédié au jeu du comptage')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Le salon Discord pour le counting game')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('record')
        .setDescription('Afficher le record actuel de comptage du serveur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Désactiver le jeu du comptage sur ce serveur')
    ),
  category: 'community',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [EmbedService.error('Permission refusée', 'Vous devez posséder la permission `Gérer le serveur` pour configurer le jeu.')],
          ephemeral: true,
        });
        return;
      }

      const targetChannel = interaction.options.getChannel('salon', true);
      await CountingService.setup(interaction.guild.id, targetChannel.id);

      const embed = EmbedService.success(
        '🔢 Counting Game activé !',
        `Le jeu du comptage est désormais configuré dans <#${targetChannel.id}>.\n\n` +
          `**Règles du jeu :**\n` +
          `1. Postez des nombres consécutifs (\`1\`, \`2\`, \`3\`...).\n` +
          `2. Vous ne pouvez pas compter deux fois d'affilée.\n` +
          `3. Une erreur réinitialise le compteur à 0 !\n\n` +
          `Bonne chance à toute l'équipe pour battre le record du serveur !`
      );

      await interaction.reply({ embeds: [embed] });
    } else if (subcommand === 'record') {
      const game = await CountingService.getRecord(interaction.guild.id);

      if (!game || !game.enabled) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Jeu non configuré',
              'Le jeu du comptage n\'est pas actif sur ce serveur. Utilisez `/counting setup` pour le configurer.'
            ),
          ],
        });
        return;
      }

      const lastUserMention = game.lastUserId ? `<@${game.lastUserId}>` : '*Aucun*';

      const embed = EmbedService.gold(
        `🏆 Record de Comptage — ${interaction.guild.name}`,
        `Voici les statistiques actuelles du Counting Game :`
      ).addFields(
        { name: '🔢 Compteur actuel', value: `**\`${game.currentCount}\`**`, inline: true },
        { name: '🏆 Meilleur record historique', value: `**\`${game.highestRecord}\`**`, inline: true },
        { name: '👤 Dernier compteur', value: lastUserMention, inline: true },
        { name: '📢 Salon actif', value: `<#${game.channelId}>`, inline: false }
      );

      await interaction.reply({ embeds: [embed] });
    } else if (subcommand === 'disable') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [EmbedService.error('Permission refusée', 'Vous devez posséder la permission `Gérer le serveur`.')],
          ephemeral: true,
        });
        return;
      }

      const disabled = await CountingService.disable(interaction.guild.id);

      if (disabled) {
        await interaction.reply({
          embeds: [EmbedService.success('Jeu désactivé', 'Le jeu du comptage a bien été désactivé sur ce serveur.')],
        });
      } else {
        await interaction.reply({
          embeds: [EmbedService.warning('Non configuré', 'Aucun jeu de comptage n\'était actif sur ce serveur.')],
        });
      }
    }
  },
};

export default countingCommand;
