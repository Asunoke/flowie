import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { EmbedBuilderService, CustomEmbedData } from '../../services/embedBuilderService.js';

const embedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Générer, personnaliser et gérer des embeds Discord')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Créer et envoyer un embed personnalisé')
        .addStringOption((opt) => opt.setName('titre').setDescription('Titre de l\'embed').setRequired(true))
        .addStringOption((opt) => opt.setName('description').setDescription('Description / Contenu').setRequired(true))
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon où envoyer l\'embed (par défaut le salon actuel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addStringOption((opt) => opt.setName('couleur').setDescription('Couleur hex (ex: #0B3D2E ou #D4AF37)').setRequired(false))
        .addStringOption((opt) => opt.setName('image').setDescription('URL de l\'image principale').setRequired(false))
        .addStringOption((opt) => opt.setName('thumbnail').setDescription('URL de la miniature').setRequired(false))
        .addStringOption((opt) => opt.setName('footer').setDescription('Texte de bas de page (footer)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('send')
        .setDescription('Envoyer un template d\'embed sauvegardé dans un salon')
        .addStringOption((opt) => opt.setName('template').setDescription('Nom du template sauvegardé').setRequired(true))
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Salon où envoyer l\'embed')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Modifier un embed déjà posté par William')
        .addStringOption((opt) => opt.setName('message_id').setDescription('ID du message à modifier').setRequired(true))
        .addStringOption((opt) => opt.setName('titre').setDescription('Nouveau titre').setRequired(false))
        .addStringOption((opt) => opt.setName('description').setDescription('Nouvelle description').setRequired(false))
        .addStringOption((opt) => opt.setName('couleur').setDescription('Nouvelle couleur hex').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('Sauvegarder un template d\'embed réutilisable')
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom du template (ex: reglement, annonce)').setRequired(true))
        .addStringOption((opt) => opt.setName('titre').setDescription('Titre du template').setRequired(true))
        .addStringOption((opt) => opt.setName('description').setDescription('Description du template').setRequired(true))
        .addStringOption((opt) => opt.setName('couleur').setDescription('Couleur hex').setRequired(false))
        .addStringOption((opt) => opt.setName('image').setDescription('URL de l\'image').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('load')
        .setDescription('Prévisualiser ou lister les templates sauvegardés')
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom du template à charger (laisser vide pour lister)').setRequired(false))
    ),
  category: 'management',
  userPermissions: [PermissionFlagsBits.ManageMessages],
  cooldown: 3,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const title = interaction.options.getString('titre', true);
      const description = interaction.options.getString('description', true);
      const channel = interaction.options.getChannel('salon') || interaction.channel;
      const color = interaction.options.getString('couleur') || undefined;
      const imageUrl = interaction.options.getString('image') || undefined;
      const thumbnailUrl = interaction.options.getString('thumbnail') || undefined;
      const footerText = interaction.options.getString('footer') || undefined;

      if (!channel || !('send' in channel)) {
        await interaction.reply({
          embeds: [EmbedService.error('Salon invalide', 'Impossible d\'envoyer le message dans ce salon.')],
          ephemeral: true,
        });
        return;
      }

      const embedData: CustomEmbedData = {
        title,
        description,
        color,
        imageUrl,
        thumbnailUrl,
        footerText,
      };

      const embed = EmbedBuilderService.buildEmbed(embedData);
      const targetChan = channel as TextChannel;

      await targetChan.send({ embeds: [embed] });

      await interaction.reply({
        embeds: [EmbedService.success('Embed envoyé !', `L'embed a bien été publié dans <#${targetChan.id}>.`)],
        ephemeral: true,
      });
    } else if (subcommand === 'send') {
      const templateName = interaction.options.getString('template', true);
      const targetChannel = interaction.options.getChannel('salon', true) as TextChannel;

      const template = await EmbedBuilderService.getTemplate(interaction.guild.id, templateName);
      if (!template) {
        await interaction.reply({
          embeds: [EmbedService.error('Template introuvable', `Aucun template nommé \`${templateName}\` n'a été trouvé.`)],
          ephemeral: true,
        });
        return;
      }

      const embedData = template.embedData as unknown as CustomEmbedData;
      const embed = EmbedBuilderService.buildEmbed(embedData);

      await targetChannel.send({ embeds: [embed] });

      await interaction.reply({
        embeds: [EmbedService.success('Template envoyé !', `Le template **${templateName}** a été envoyé dans <#${targetChannel.id}>.`)],
        ephemeral: true,
      });
    } else if (subcommand === 'edit') {
      const messageId = interaction.options.getString('message_id', true);
      const title = interaction.options.getString('titre') || undefined;
      const description = interaction.options.getString('description') || undefined;
      const color = interaction.options.getString('couleur') || undefined;

      const currentChan = interaction.channel as TextChannel;

      try {
        const targetMsg = await currentChan.messages.fetch(messageId).catch(() => null);
        if (!targetMsg) {
          await interaction.reply({
            embeds: [EmbedService.error('Message introuvable', `Le message \`${messageId}\` n'a pas été trouvé dans ce salon.`)],
            ephemeral: true,
          });
          return;
        }

        const existingEmbed = targetMsg.embeds[0];
        const updatedData: CustomEmbedData = {
          title: title || existingEmbed?.title || undefined,
          description: description || existingEmbed?.description || undefined,
          color: color || (existingEmbed?.color ? `#${existingEmbed.color.toString(16)}` : undefined),
          imageUrl: existingEmbed?.image?.url,
          thumbnailUrl: existingEmbed?.thumbnail?.url,
        };

        await EmbedBuilderService.editBotEmbed(currentChan, messageId, updatedData);

        await interaction.reply({
          embeds: [EmbedService.success('Embed modifié', `Le message \`${messageId}\` a été mis à jour avec succès.`)],
          ephemeral: true,
        });
      } catch (err: any) {
        await interaction.reply({
          embeds: [EmbedService.error('Modification échouée', err.message || 'Une erreur est survenue.')],
          ephemeral: true,
        });
      }
    } else if (subcommand === 'save') {
      const name = interaction.options.getString('nom', true);
      const title = interaction.options.getString('titre', true);
      const description = interaction.options.getString('description', true);
      const color = interaction.options.getString('couleur') || undefined;
      const imageUrl = interaction.options.getString('image') || undefined;

      const embedData: CustomEmbedData = { title, description, color, imageUrl };

      await EmbedBuilderService.saveTemplate(
        interaction.guild.id,
        name,
        embedData,
        interaction.user.id
      );

      await interaction.reply({
        embeds: [
          EmbedService.success(
            'Template sauvegardé !',
            `Le template d'embed **${name}** a bien été enregistré. Vous pouvez l'envoyer avec \`/embed send template:${name}\`.`
          ),
        ],
        ephemeral: true,
      });
    } else if (subcommand === 'load') {
      const name = interaction.options.getString('nom');

      if (name) {
        const template = await EmbedBuilderService.getTemplate(interaction.guild.id, name);
        if (!template) {
          await interaction.reply({
            embeds: [EmbedService.error('Template introuvable', `Aucun template nommé \`${name}\` n'existe.`)],
            ephemeral: true,
          });
          return;
        }

        const embedData = template.embedData as unknown as CustomEmbedData;
        const embed = EmbedBuilderService.buildEmbed(embedData);

        await interaction.reply({
          content: `👁️ **Prévisualisation du template :** \`${template.name}\``,
          embeds: [embed],
          ephemeral: true,
        });
      } else {
        const templates = await EmbedBuilderService.listTemplates(interaction.guild.id);
        if (templates.length === 0) {
          await interaction.reply({
            embeds: [EmbedService.warning('Aucun template', 'Aucun template d\'embed n\'est enregistré sur ce serveur. Utilise `/embed save` pour en ajouter.')],
            ephemeral: true,
          });
          return;
        }

        const listText = templates.map((t: { name: string; createdBy: string }, idx: number) => `**${idx + 1}.** \`${t.name}\` (créé par <@${t.createdBy}>)`).join('\n');

        const embed = EmbedService.create(`📁 Templates d'embeds — ${interaction.guild.name}`, listText);

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  },
};

export default embedCommand;
