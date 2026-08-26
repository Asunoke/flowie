import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ApplyService, FormQuestion } from '../../services/applyService.js';

const applySetupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('apply-setup')
    .setDescription('Configurer un formulaire de recrutement pour un poste')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('poste')
        .setDescription('Nom du poste (ex: Modérateur, Animateur, Partenariat)')
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('salon-review')
        .setDescription('Le salon privé staff où les candidatures seront envoyées')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('q1')
        .setDescription('Question 1 (ex: Présentation & Âge)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('q2')
        .setDescription('Question 2 (ex: Expérience à ce poste)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('q3')
        .setDescription('Question 3 (ex: Disponibilités hebdomadaires)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('q4')
        .setDescription('Question 4 (ex: Pourquoi notre serveur ?)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('q5')
        .setDescription('Question 5 (ex: Remarques ou informations complémentaires)')
        .setRequired(false)
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const position = interaction.options.getString('poste', true);
    const reviewChannel = interaction.options.getChannel('salon-review', true);

    const q1 = interaction.options.getString('q1');
    const q2 = interaction.options.getString('q2');
    const q3 = interaction.options.getString('q3');
    const q4 = interaction.options.getString('q4');
    const q5 = interaction.options.getString('q5');

    // Build question list (default fallback questions if none specified)
    const rawQuestions: string[] = [q1, q2, q3, q4, q5].filter((q): q is string => Boolean(q && q.trim()));

    if (rawQuestions.length === 0) {
      rawQuestions.push(
        'Présentation personnelle (Prénom/Pseudo, âge)',
        'Vos expériences antérieures à ce poste',
        'Vos disponibilités hebdomadaires',
        'Pourquoi souhaitez-vous rejoindre notre équipe ?'
      );
    }

    const questions: FormQuestion[] = rawQuestions.map((label, idx) => ({
      id: `q_${idx + 1}`,
      label: label.trim(),
      style: 'paragraph',
      required: true,
    }));

    await ApplyService.createForm(
      interaction.guild.id,
      position,
      reviewChannel.id,
      questions
    );

    const embed = EmbedService.success(
      '📝 Formulaire de Candidature Configuré !',
      `Le poste **${position}** a bien été enregistré.`
    ).addFields(
      { name: '💼 Poste', value: `\`${position}\``, inline: true },
      { name: '🔒 Salon de review staff', value: `<#${reviewChannel.id}>`, inline: true },
      {
        name: '❓ Questions configurées',
        value: questions.map((q, idx) => `**${idx + 1}.** ${q.label}`).join('\n'),
        inline: false,
      },
      {
        name: '🚀 Prochaine étape',
        value: `Utilisez la commande \`/apply poste:${position}\` pour publier le panneau de candidature dans un salon public.`,
        inline: false,
      }
    );

    await interaction.reply({ embeds: [embed] });
  },
};

export default applySetupCommand;
