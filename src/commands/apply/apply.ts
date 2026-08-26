import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { ApplyService, FormQuestion } from '../../services/applyService.js';
import { config } from '../../config/index.js';

const applyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Publier un panneau de recrutement pour un poste')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('poste')
        .setDescription('Nom du poste pour lequel recruter')
        .setRequired(true)
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const position = interaction.options.getString('poste', true);
    const form = await ApplyService.getForm(interaction.guild.id, position);

    if (!form) {
      await interaction.reply({
        embeds: [
          EmbedService.warning(
            'Poste non configuré',
            `Aucun formulaire n'a été trouvé pour le poste **${position}**.\n` +
              `Utilisez d'abord la commande \`/apply-setup poste:${position} salon-review:#salon\` pour le configurer.`
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const questionsList = (form.questions as unknown as FormQuestion[]) || [];

    const embed = EmbedService.gold(
      `💼 Recrutement — ${form.position}`,
      `Notre équipe recherche activement pour le poste de **${form.position}** !\n\n` +
        `**Informations :**\n` +
        `• **Nombre de questions :** \`${questionsList.length}\`\n` +
        `• **Traitement :** Les réponses sont étudiées directement par notre équipe staff.\n\n` +
        `Pour déposer votre candidature, cliquez sur le bouton ci-dessous.`
    ).setFooter({ text: `${config.bot.signature} • Recrutement` });

    const applyButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`apply_start:${form.position}`)
        .setLabel(`Postuler comme ${form.position}`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('📝')
    );

    await interaction.reply({ embeds: [embed], components: [applyButton] });
  },
};

export default applyCommand;
