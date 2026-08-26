import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import { prisma } from '../database/db.js';
import { EmbedService } from './embedService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface FormQuestion {
  id: string;
  label: string;
  style: 'short' | 'paragraph';
  required?: boolean;
}

export class ApplyService {
  /**
   * Creates or updates an application form for a specific position
   */
  static async createForm(
    guildId: string,
    position: string,
    reviewChannelId: string,
    questions: FormQuestion[]
  ) {
    const cleanPosition = position.trim();
    return prisma.applicationForm.upsert({
      where: { guildId_position: { guildId, position: cleanPosition } },
      create: {
        guildId,
        position: cleanPosition,
        reviewChannelId,
        questions: questions as any,
      },
      update: {
        reviewChannelId,
        questions: questions as any,
      },
    });
  }

  /**
   * Retrieves an application form configuration
   */
  static async getForm(guildId: string, position: string) {
    return prisma.applicationForm.findUnique({
      where: { guildId_position: { guildId, position: position.trim() } },
    });
  }

  /**
   * Lists all application forms available in a guild
   */
  static async listForms(guildId: string) {
    return prisma.applicationForm.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Deletes an application form
   */
  static async deleteForm(guildId: string, position: string): Promise<boolean> {
    const res = await prisma.applicationForm.deleteMany({
      where: { guildId, position: position.trim() },
    });
    return res.count > 0;
  }

  /**
   * Submits a candidate's completed application, posts to review channel with action buttons
   */
  static async submitApplication(
    guildId: string,
    position: string,
    applicantId: string,
    answers: Record<string, string>,
    reviewChannel: TextChannel
  ) {
    const app = await prisma.application.create({
      data: {
        guildId,
        position,
        applicantId,
        answers: answers as any,
        status: 'pending',
      },
    });

    const embed = EmbedService.create(
      `📋 Candidature — ${position}`,
      `**Candidat :** <@${applicantId}> (\`${applicantId}\`)\n` +
        `**Statut :** ⏳ \`En attente de décision\`\n\n` +
        `**Réponses au questionnaire :**`
    );

    for (const [questionLabel, answerText] of Object.entries(answers)) {
      // Limit field value to 1024 characters
      const truncated = answerText.length > 1000 ? answerText.slice(0, 997) + '...' : answerText;
      embed.addFields({ name: `❓ ${questionLabel}`, value: `> ${truncated}`, inline: false });
    }

    embed.setFooter({ text: `ID Candidature : ${app.id} • ${config.bot.signature}` });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`apply_review_accept:${app.id}`)
        .setLabel('Accepter')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`apply_review_reject:${app.id}`)
        .setLabel('Refuser')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
      new ButtonBuilder()
        .setCustomId(`apply_review_interview:${app.id}`)
        .setLabel('En entretien')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💬')
    );

    const sentMessage = await reviewChannel.send({ embeds: [embed], components: [buttons] });

    await prisma.application.update({
      where: { id: app.id },
      data: { messageId: sentMessage.id },
    });

    return app;
  }

  /**
   * Reviews an application (accept/reject/interview), updates the staff review embed, and notifies the applicant via DM
   */
  static async reviewApplication(
    applicationId: string,
    reviewerId: string,
    newStatus: 'accepted' | 'rejected' | 'interview',
    client: Client,
    reviewMessage?: Message
  ) {
    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!app) {
      throw new Error('Candidature introuvable.');
    }

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: newStatus,
        reviewedBy: reviewerId,
      },
    });

    const statusBadge =
      newStatus === 'accepted'
        ? '✅ `Acceptée`'
        : newStatus === 'rejected'
        ? '❌ `Refusée`'
        : '💬 `En entretien`';

    // Update staff review message if present
    if (reviewMessage && reviewMessage.embeds.length > 0) {
      const existingEmbed = reviewMessage.embeds[0];
      const updatedEmbed = EmbedService.create(
        existingEmbed.title || `📋 Candidature — ${app.position}`,
        `**Candidat :** <@${app.applicantId}>\n` +
          `**Statut :** ${statusBadge} par <@${reviewerId}>\n\n` +
          `**Réponses au questionnaire :**`
      );

      // Re-add question fields
      const answersMap = (app.answers as Record<string, string>) || {};
      for (const [q, a] of Object.entries(answersMap)) {
        updatedEmbed.addFields({ name: `❓ ${q}`, value: `> ${a}`, inline: false });
      }

      updatedEmbed.setFooter({ text: `ID Candidature : ${app.id} • Décision enregistrée` });

      // Disabled decision buttons showing final state
      const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('disabled_accept')
          .setLabel('Acceptée')
          .setStyle(newStatus === 'accepted' ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('disabled_reject')
          .setLabel('Refusée')
          .setStyle(newStatus === 'rejected' ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('disabled_interview')
          .setLabel('En entretien')
          .setStyle(newStatus === 'interview' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await reviewMessage.edit({ embeds: [updatedEmbed], components: [disabledButtons] }).catch(() => null);
    }

    // DM Notification to Applicant
    try {
      const applicantUser = await client.users.fetch(app.applicantId).catch(() => null);
      if (applicantUser) {
        let dmTitle = '';
        let dmDesc = '';

        if (newStatus === 'accepted') {
          dmTitle = '🎉 Candidature Acceptée !';
          dmDesc = `Félicitations ! Votre candidature pour le poste **${app.position}** a été **ACCEPTÉE** par l'équipe staff.\n` +
            `Un responsable prendra contact avec vous rapidement.`;
        } else if (newStatus === 'rejected') {
          dmTitle = '❌ Candidature Refusée';
          dmDesc = `Votre candidature pour le poste **${app.position}** n'a pas été retenue.\n` +
            `Nous vous remercions pour l'intérêt que vous portez au serveur.`;
        } else {
          dmTitle = '💬 Candidature retenue pour un Entretien';
          dmDesc = `Votre candidature pour le poste **${app.position}** avance ! Vous êtes convoqué(e) à un **entretien**.\n` +
            `Un membre du staff va vous contacter sous peu.`;
        }

        const dmEmbed = EmbedService.create(dmTitle, dmDesc);
        await applicantUser.send({ embeds: [dmEmbed] }).catch(() => {
          logger.debug(`[APPLY] Could not send DM to applicant ${app.applicantId}`);
        });
      }
    } catch (err) {
      logger.error({ err, applicantId: app.applicantId }, '[APPLY] Error sending DM to applicant');
    }

    return app;
  }
}
