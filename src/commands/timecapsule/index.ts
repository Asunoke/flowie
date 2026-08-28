import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { TimeCapsuleService } from '../../services/timeCapsuleService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('timecapsule')
    .setDescription('Gérer et créer des capsules temporelles')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Créer une capsule temporelle scellée')
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Le contenu du message secret de la capsule (max 2000 car.)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('declencheur')
            .setDescription('Date future (ex: 2027-01-01, 6 mois, 24h) ou palier (ex: 1000 membres)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('visibilite')
            .setDescription('Visibilité de la capsule sur le serveur (défaut: Publique)')
            .addChoices(
              { name: '👁️ Publique (existence visible, contenu scellé)', value: 'public' },
              { name: '🤫 Secrète (totalement masquée jusqu à l ouverture)', value: 'secret' }
            )
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Lister les capsules publiques en attente sur le serveur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('mine')
        .setDescription('Consulter la liste de vos capsules créées sur ce serveur')
    ),
  category: 'timecapsule',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    // ─── 1. CREATE SUBCOMMAND ───────────────────────────────────────────────
    if (subcommand === 'create') {
      const messageContent = interaction.options.getString('message', true);
      const triggerInput = interaction.options.getString('declencheur', true);
      const visibility = interaction.options.getString('visibilite') || 'public';
      const isPublic = visibility === 'public';

      // Dry-run parse trigger to catch validation errors early before showing prompt
      let parsedTrigger;
      try {
        parsedTrigger = TimeCapsuleService.parseTrigger(triggerInput, interaction.guild.memberCount);
      } catch (err: any) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur de création', err?.message || 'Format de déclencheur invalide.')],
          ephemeral: true,
        });
        return;
      }

      // Format trigger description for recap
      let triggerDesc = '';
      if (parsedTrigger.type === 'date' && parsedTrigger.date) {
        triggerDesc = `📅 Date : <t:${Math.floor(parsedTrigger.date.getTime() / 1000)}:f> (<t:${Math.floor(parsedTrigger.date.getTime() / 1000)}:R>)`;
      } else if (parsedTrigger.type === 'member_count' && parsedTrigger.memberCount) {
        triggerDesc = `👥 Palier de membres : **${parsedTrigger.memberCount} membres** (Actuel : ${interaction.guild.memberCount})`;
      }

      // Build confirmation embed
      const recapEmbed = EmbedService.gold(
        '🔒 Confirmation de création de capsule temporelle',
        'Veuillez vérifier les informations récapitulatives ci-dessous avant de sceller définitivement votre capsule.'
      ).addFields(
        { name: '⏰ Déclencheur', value: triggerDesc, inline: false },
        { name: '👁️ Visibilité', value: isPublic ? '`Publique` (visibilité de l existence, contenu scellé)' : '`Totalement Secrète` (masquée jusqu à ouverture)', inline: false },
        { name: '📜 Message (aperçu auteur)', value: messageContent.length > 300 ? messageContent.slice(0, 300) + '...' : messageContent, inline: false }
      );

      const confirmBtn = new ButtonBuilder()
        .setCustomId('capsule_confirm')
        .setLabel('🔒 Sceller la capsule')
        .setStyle(ButtonStyle.Success);

      const cancelBtn = new ButtonBuilder()
        .setCustomId('capsule_cancel')
        .setLabel('❌ Annuler')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

      const reply = await interaction.reply({
        embeds: [recapEmbed],
        components: [row],
        ephemeral: true,
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on('collect', async (btnInteraction) => {
        if (btnInteraction.customId === 'capsule_confirm') {
          try {
            const created = await TimeCapsuleService.createCapsule({
              guildId: interaction.guildId!,
              authorId: interaction.user.id,
              authorTag: interaction.user.tag,
              content: messageContent,
              triggerInput,
              isPublic,
              currentMemberCount: interaction.guild!.memberCount,
            });

            const successEmbed = EmbedService.success(
              'Capsule temporelle scellée ! ⏳',
              `Votre capsule \`#${created.id.slice(-6)}\` a été créée et scellée avec succès. Elle s ouvrira automatiquement dans le salon dédié dès que son déclencheur sera atteint.`
            );

            await btnInteraction.update({
              embeds: [successEmbed],
              components: [],
            });
          } catch (createErr: any) {
            await btnInteraction.update({
              embeds: [EmbedService.error('Échec de la création', createErr?.message || 'Une erreur est survenue.')],
              components: [],
            });
          }
        } else {
          await btnInteraction.update({
            embeds: [EmbedService.warning('Création annulée', 'La création de la capsule temporelle a été annulée.')],
            components: [],
          });
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          await interaction.editReply({
            embeds: [EmbedService.warning('Temps écoulé', 'La confirmation a expiré. Aucune capsule n a été créée.')],
            components: [],
          }).catch(() => null);
        }
      });

      return;
    }

    // ─── 2. LIST SUBCOMMAND ─────────────────────────────────────────────────
    if (subcommand === 'list') {
      const capsules = await TimeCapsuleService.listPublicCapsules(interaction.guild.id);

      if (capsules.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.gold('⏳ Capsules Publiques', 'Aucune capsule temporelle publique en attente sur ce serveur.')],
        });
        return;
      }

      const embed = EmbedService.gold(
        `⏳ Capsules Publiques en Attente (${capsules.length})`,
        'Voici les capsules temporelles scellées visibles sur ce serveur. Le contenu reste strictement confidentiel jusqu à l ouverture !'
      );

      capsules.slice(0, 15).forEach((cap: any) => {
        let triggerStr = '';
        if (cap.triggerType === 'date' && cap.triggerDate) {
          triggerStr = `Prévue le <t:${Math.floor(cap.triggerDate.getTime() / 1000)}:f> (<t:${Math.floor(cap.triggerDate.getTime() / 1000)}:R>)`;
        } else if (cap.triggerType === 'member_count' && cap.triggerMemberCount) {
          triggerStr = `Palier de membres : **${cap.triggerMemberCount} membres** (Actuel : ${interaction.guild!.memberCount})`;
        } else {
          triggerStr = 'Inconnu';
        }

        embed.addFields({
          name: `📦 Capsule #${cap.id.slice(-6)}`,
          value: `👤 **Auteur** : <@${cap.authorId}>\n🎯 **Déclencheur** : ${triggerStr}\n📅 **Scellée le** : <t:${Math.floor(cap.createdAt.getTime() / 1000)}:d>`,
          inline: false,
        });
      });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ─── 3. MINE SUBCOMMAND ─────────────────────────────────────────────────
    if (subcommand === 'mine') {
      const capsules = await TimeCapsuleService.listUserCapsules(interaction.guild.id, interaction.user.id);

      if (capsules.length === 0) {
        await interaction.reply({
          embeds: [EmbedService.gold('⏳ Mes Capsules', 'Vous n avez créé aucune capsule temporelle sur ce serveur.')],
          ephemeral: true,
        });
        return;
      }

      const embed = EmbedService.gold(
        `⏳ Mes Capsules Temporelles (${capsules.length})`,
        'Voici l historique et l état de vos capsules créées sur ce serveur :'
      );

      capsules.slice(0, 15).forEach((cap: any) => {
        let triggerStr = '';
        if (cap.triggerType === 'date' && cap.triggerDate) {
          triggerStr = `Date : <t:${Math.floor(cap.triggerDate.getTime() / 1000)}:f>`;
        } else if (cap.triggerType === 'member_count' && cap.triggerMemberCount) {
          triggerStr = `Palier : **${cap.triggerMemberCount} membres**`;
        }

        const visStr = cap.isPublic ? '👁️ Publique' : '🤫 Secrète';
        const statusStr = cap.opened
          ? `🔓 **Ouverte** le <t:${Math.floor((cap.openedAt || new Date()).getTime() / 1000)}:f>`
          : '⏳ **En attente de déclenchement**';

        embed.addFields({
          name: `📦 Capsule #${cap.id.slice(-6)} (${visStr})`,
          value: `📌 **Statut** : ${statusStr}\n🎯 **Déclencheur** : ${triggerStr}\n📅 **Scellée le** : <t:${Math.floor(cap.createdAt.getTime() / 1000)}:d>`,
          inline: false,
        });
      });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};

export default command;
