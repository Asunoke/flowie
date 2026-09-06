import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { AuraService } from '../../services/auraService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('aura')
    .setDescription('Système de réputation sociale et d endorsements d aura')
    .addSubcommand((sub) =>
      sub
        .setName('endorse')
        .setDescription('Endorser un membre sur une qualité spécifique')
        .addUserOption((opt) =>
          opt
            .setName('membre')
            .setDescription('Le membre à endorser')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('qualite')
            .setDescription('La qualité attribuée (ex: Fiable, Créatif, Drôle...)')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('Consulter le profil d aura et le palier d un membre')
        .addUserOption((opt) =>
          opt
            .setName('membre')
            .setDescription('Le membre à consulter (vous-même par défaut)')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('Afficher le classement des membres par score d aura')
        .addStringOption((opt) =>
          opt
            .setName('qualite')
            .setDescription('Filtrer le classement par une qualité spécifique')
            .setAutocomplete(true)
        )
    ),
  category: 'aura',
  cooldown: 3,

  async autocomplete(interaction: any) {
    if (!interaction.guild) return;
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'qualite') {
      const qualities = await AuraService.getQualities(interaction.guild.id);
      const filtered = qualities.filter((q) =>
        q.toLowerCase().startsWith(focusedOption.value.toLowerCase())
      );
      await interaction.respond(
        filtered.slice(0, 25).map((q) => ({ name: q, value: q }))
      );
    }
  },

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ─── 1. ENDORSE SUBCOMMAND ───────────────────────────────────────────
    if (subcommand === 'endorse') {
      const targetUser = interaction.options.getUser('membre', true);
      const qualityInput = interaction.options.getString('qualite', true);

      const result = await AuraService.endorseMember(
        interaction.guild,
        interaction.user.id,
        targetUser.id,
        qualityInput
      );

      if (!result.success) {
        if (result.reason === 'self_endorse') {
          await interaction.reply({
            embeds: [EmbedService.error('Action Impossible', 'Vous ne pouvez pas vous endorser vous-même !')],
            ephemeral: true,
          });
        } else if (result.reason === 'disabled') {
          await interaction.reply({
            embeds: [EmbedService.warning('Module Désactivé', 'Le module d Aura est actuellement désactivé sur ce serveur.')],
            ephemeral: true,
          });
        } else if (result.reason === 'invalid_quality') {
          const available = await AuraService.getQualities(guildId);
          await interaction.reply({
            embeds: [
              EmbedService.error(
                'Qualité Invalide',
                `La qualité \`${qualityInput}\` n existe pas sur ce serveur.\nQualités disponibles : ${available.map((q) => `\`${q}\``).join(', ')}`
              ),
            ],
            ephemeral: true,
          });
        } else if (result.reason === 'pair_cooldown') {
          const hours = Math.floor((result.remainingSec || 0) / 3600);
          const mins = Math.ceil(((result.remainingSec || 0) % 3600) / 60);
          await interaction.reply({
            embeds: [
              EmbedService.warning(
                '⏳ Cooldown d Endorsement',
                `Vous avez déjà endorsé ${targetUser} récemment.\nVous pourrez de nouveau l'endorser dans **${hours}h ${mins}m**.`
              ),
            ],
            ephemeral: true,
          });
        } else if (result.reason === 'daily_limit') {
          await interaction.reply({
            embeds: [
              EmbedService.warning(
                '🚫 Limite Quotidienne Atteinte',
                `Vous avez atteint votre limite de **${result.dailyLimit} endorsements par 24h**.`
              ),
            ],
            ephemeral: true,
          });
        }
        return;
      }

      const embed = EmbedService.success(
        '🌟 Endorsement Attribué !',
        `Vous avez endorsé ${targetUser} sur la qualité **${result.quality}** !`
      ).addFields(
        { name: '✨ NOUVEAU SCORE', value: `\`${result.totalScore} points\``, inline: true },
        { name: '🏅 PALIER ACTUEL', value: `**${result.currentTier?.name}**`, inline: true }
      ).setFooter({ text: 'Aura • Réputation sociale Discord' });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ─── 2. PROFILE SUBCOMMAND ───────────────────────────────────────────
    if (subcommand === 'profile') {
      const targetUser = interaction.options.getUser('membre') || interaction.user;
      const profile = await AuraService.getAuraProfile(guildId, targetUser.id);

      const embed = EmbedService.gold(
        `🌟 Profil d Aura — ${targetUser.tag}`,
        `Aperçu complet de la réputation et du rayonnement social.`
      ).addFields(
        { name: '✨ Score d Aura Total', value: `\`${profile.totalScore} points\``, inline: true },
        { name: '🏅 Palier Actuel', value: `**${profile.currentTier.name}**`, inline: true }
      );

      if (profile.nextTier) {
        embed.addFields({
          name: '📈 Prochain Palier',
          value: `**${profile.nextTier.name}** à \`${profile.nextTier.minScore} pts\` (\`${profile.progressPercent}%\` — ${profile.totalScore}/${profile.nextTier.minScore})`,
          inline: false,
        });
      }

      if (profile.breakdown.length > 0) {
        const breakdownLines = profile.breakdown.map(
          (b) => `• **${b.name}** : \`${b.count} pts\` (${b.percent}%)\n  \`${b.bar}\``
        );
        embed.addFields({ name: '✨ Répartition des Qualités', value: breakdownLines.join('\n\n'), inline: false });
      }

      if (profile.recentEndorsements.length > 0) {
        const recentLines = profile.recentEndorsements.map(
          (e: any) => `• <@${e.fromUserId}> sur **${e.quality}** (<t:${Math.floor(e.createdAt.getTime() / 1000)}:R>)`
        );
        embed.addFields({ name: '📜 Derniers Endorsements Reçus', value: recentLines.join('\n'), inline: false });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ─── 3. LEADERBOARD SUBCOMMAND ───────────────────────────────────────
    if (subcommand === 'leaderboard') {
      const qualityFilter = interaction.options.getString('qualite');
      const leaderboard = await AuraService.getLeaderboard(guildId, qualityFilter || undefined);

      if (leaderboard.length === 0) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              '🏆 Classement Vide',
              qualityFilter
                ? `Aucun endorsement n'a encore été attribué pour la qualité \`${qualityFilter}\`.`
                : 'Aucun membre n a encore reçu d endorsement sur ce serveur.'
            ),
          ],
        });
        return;
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines = leaderboard.map(
        (entry: any) => `${medals[entry.rank - 1] || `\`#${entry.rank}\``} <@${entry.userId}> — **${entry.score} pts** *(Palier: ${entry.tierName})*`
      );

      const embed = EmbedService.gold(
        `🏆 Classement d Aura — ${interaction.guild.name}${qualityFilter ? ` (${qualityFilter})` : ''}`,
        lines.join('\n')
      ).setFooter({ text: 'Aura • Réputation sociale Discord' });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
