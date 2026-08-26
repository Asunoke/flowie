import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { BirthdayService } from '../../services/birthdayService.js';

const birthdayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Gérer et afficher les anniversaires des membres')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Enregistrer votre date d\'anniversaire')
        .addIntegerOption((opt) =>
          opt
            .setName('jour')
            .setDescription('Jour de votre naissance (1 à 31)')
            .setMinValue(1)
            .setMaxValue(31)
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('mois')
            .setDescription('Mois de votre naissance (1 à 12)')
            .setMinValue(1)
            .setMaxValue(12)
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('année')
            .setDescription('Année de votre naissance (optionnel)')
            .setMinValue(1920)
            .setMaxValue(new Date().getFullYear())
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Supprimer votre date d\'anniversaire enregistrée')
    )
    .addSubcommand((sub) =>
      sub
        .setName('next')
        .setDescription('Afficher les prochains anniversaires à venir sur ce serveur')
        .addIntegerOption((opt) =>
          opt.setName('page').setDescription('Numéro de la page').setMinValue(1).setRequired(false)
        )
    ),
  category: 'community',
  cooldown: 5,
  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const day = interaction.options.getInteger('jour', true);
      const month = interaction.options.getInteger('mois', true);
      const year = interaction.options.getInteger('année') || undefined;

      try {
        await BirthdayService.setBirthday(interaction.guild.id, interaction.user.id, day, month, year);

        const monthName = BirthdayService.getMonthName(month);
        const yearText = year ? ` ${year}` : '';

        const embed = EmbedService.success(
          '🎂 Anniversaire enregistré !',
          `Votre date d'anniversaire a bien été enregistrée pour le **${day} ${monthName}${yearText}**.\n` +
            `Le bot vous souhaitera votre anniversaire dans le salon configuré !`
        );

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err: any) {
        await interaction.reply({
          embeds: [EmbedService.error('Date invalide', err.message || 'La date saisie est invalide.')],
          ephemeral: true,
        });
      }
    } else if (subcommand === 'remove') {
      const removed = await BirthdayService.removeBirthday(interaction.guild.id, interaction.user.id);

      if (removed) {
        await interaction.reply({
          embeds: [
            EmbedService.success(
              'Anniversaire supprimé',
              'Votre date d\'anniversaire a bien été retirée du serveur.'
            ),
          ],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Aucune donnée',
              'Vous n\'aviez aucune date d\'anniversaire enregistrée sur ce serveur.'
            ),
          ],
          ephemeral: true,
        });
      }
    } else if (subcommand === 'next') {
      const page = interaction.options.getInteger('page') || 1;
      const pageSize = 10;
      const { entries, totalPages } = await BirthdayService.getNextBirthdays(
        interaction.guild.id,
        page,
        pageSize
      );

      if (entries.length === 0) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              'Aucun anniversaire',
              'Aucun membre n\'a enregistré sa date d\'anniversaire sur ce serveur.\nUtilisez `/birthday set` pour enregistrer la vôtre !'
            ),
          ],
        });
        return;
      }

      const descriptionLines = entries.map((b, idx) => {
        const rank = (page - 1) * pageSize + idx + 1;
        const monthName = BirthdayService.getMonthName(b.month);
        const daysText = b.daysUntil === 0 ? '**Aujourd\'hui ! 🎉**' : `dans **${b.daysUntil} jour(s)**`;
        const yearText = b.year ? ` (${b.year})` : '';

        return `**${rank}.** <@${b.userId}> — **${b.day} ${monthName}**${yearText} (${daysText})`;
      });

      const embed = EmbedService.create(
        `🎂 Prochains Anniversaires — ${interaction.guild.name}`,
        descriptionLines.join('\n')
      ).setFooter({ text: `Page ${page}/${totalPages} • Flowie Anniversaires` });

      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default birthdayCommand;
