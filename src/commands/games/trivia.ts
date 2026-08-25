import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { prisma } from '../../database/db.js';
import { EconomyService } from '../../services/economyService.js';
import { EmbedService } from '../../services/embedService.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Répondre à une question de culture générale et gagner de la monnaie'),
  category: 'games',
  cooldown: 10,
  async execute(interaction) {
    if (!interaction.guild) return;

    const currency = await EconomyService.getCurrencyName(interaction.guild.id);

    // Fetch question from DB or fallback
    let triviaList = await prisma.triviaQuestion.findMany();

    if (triviaList.length === 0) {
      triviaList = [
        {
          id: '1',
          category: 'Informatique',
          question: 'Quel langage de programmation est utilisé par le bot Flowie ?',
          options: ['Python', 'TypeScript', 'Java', 'PHP'],
          answer: 'TypeScript',
          reward: 75,
          createdAt: new Date(),
        },
        {
          id: '2',
          category: 'Sciences',
          question: 'Combien de planètes composent le Système Solaire ?',
          options: ['7', '8', '9', '10'],
          answer: '8',
          reward: 50,
          createdAt: new Date(),
        },
        {
          id: '3',
          category: 'Histoire',
          question: 'En quelle année a eu lieu la Révolution Française ?',
          options: ['1789', '1815', '1776', '1492'],
          answer: '1789',
          reward: 60,
          createdAt: new Date(),
        },
      ];
    }

    const item = triviaList[Math.floor(Math.random() * triviaList.length)];
    const buttons = item.options.map((opt: string, i: number) =>
      new ButtonBuilder()
        .setCustomId(`trivia_opt_${i}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Primary)
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    const embed = EmbedService.gold(
      `🧠 Quiz Trivia — ${item.category}`,
      `**Question** : ${item.question}\n\n*Répondez en moins de 15 secondes pour remporter **+${item.reward} ${currency}** !*`
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (btnInt) => btnInt.user.id === interaction.user.id,
      time: 15000,
    });

    collector.on('collect', async (btnInt) => {
      collector.stop('answered');
      const selectedIndex = parseInt(btnInt.customId.replace('trivia_opt_', ''), 10);
      const selectedText = item.options[selectedIndex];

      if (selectedText === item.answer) {
        await EconomyService.addBalance(
          interaction.guild!.id,
          interaction.user.id,
          item.reward,
          'GAME_WIN',
          `Gains Quiz Trivia (+${item.reward})`
        );

        await btnInt.update({
          embeds: [
            EmbedService.success(
              '🎯 Bonne Réponse !',
              `Excellente réponse ! La bonne réponse était bien **${item.answer}**.\nVous gagnez **+${item.reward} ${currency}** !`
            ),
          ],
          components: [],
        });
      } else {
        await btnInt.update({
          embeds: [
            EmbedService.error(
              '❌ Mauvaise Réponse',
              `Dommage ! Vous avez choisi **${selectedText}**.\nLa bonne réponse était : **${item.answer}**.`
            ),
          ],
          components: [],
        });
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          embeds: [
            EmbedService.warning(
              '⏰ Temps Écoulé',
              `Le temps imparti de 15 secondes est écoulé. La réponse était **${item.answer}**.`
            ),
          ],
          components: [],
        }).catch(() => null);
      }
    });
  },
};

export default command;
