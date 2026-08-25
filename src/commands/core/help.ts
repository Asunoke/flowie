import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { EmbedService } from '../../services/embedService.js';
import { config } from '../../config/index.js';

const HELP_IMAGE_URL = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche le centre d assistance interactif et la liste de toutes les commandes de Flowie'),
  category: 'core',
  cooldown: 3,

  async execute(interaction) {
    const categoryDetails: Record<
      string,
      { title: string; desc: string; icon: string; commands: { name: string; desc: string }[] }
    > = {
      core: {
        title: '⚙️ Module Core & Système',
        desc: 'Commandes générales d\'information et de statistiques du bot.',
        icon: '⚙️',
        commands: [
          { name: '/ping', desc: 'Affiche la latence du bot et de l\'API Discord' },
          { name: '/help', desc: 'Affiche le centre d\'assistance interactif avec sélecteur de module' },
          { name: '/info', desc: 'Informations générales sur Flowie et Florynx Labs' },
          { name: '/botstats', desc: 'Statistiques mémoire, uptime et état du système' },
        ],
      },
      moderation: {
        title: '🛡️ Module Modération & Cases',
        desc: 'Outils complets de modération avec journalisation et gestion des cas.',
        icon: '🛡️',
        commands: [
          { name: '/warn <membre> <raison>', desc: 'Avertir un membre avec escalades auto (3 warns = mute, 5 = ban)' },
          { name: '/warnings <membre>', desc: 'Afficher l\'historique des avertissements d\'un membre' },
          { name: '/softban <membre> [raison]', desc: 'Expulser un membre et purger ses messages récents' },
          { name: '/slowmode <secondes> [#salon]', desc: 'Activer ou désactiver le mode lent sur un salon' },
          { name: '/nickname set|reset <membre>', desc: 'Forcer ou réinitialiser le pseudonyme d\'un membre' },
          { name: '/purge-user <membre> <nombre>', desc: 'Purger les messages d\'un membre précis dans un salon' },
          { name: '/case <id>', desc: 'Afficher le détail d\'un dossier de modération' },
          { name: '/case-history <membre>', desc: 'Liste paginée de tous les cas de modération d\'un membre' },
          { name: '/ban <membre> [raison]', desc: 'Bannir un membre du serveur' },
          { name: '/kick <membre> [raison]', desc: 'Expulser un membre du serveur' },
          { name: '/mute <membre> <minutes>', desc: 'Rendre un membre muet temporairement' },
          { name: '/clear <nombre>', desc: 'Suppression en masse de messages' },
        ],
      },
      management: {
        title: '📊 Module Gestion & Setup',
        desc: 'Configuration globale, assistant pas-à-pas et rôles interactifs.',
        icon: '📊',
        commands: [
          { name: '/setup', desc: 'Assistant interactif pas-à-pas par boutons pour configurer le serveur' },
          { name: '/config <subcommand>', desc: 'Configuration détaillée du serveur (logs, devises, anti-spam...)' },
          { name: '/welcome', desc: 'Vue d\'ensemble et configuration des messages de bienvenue/départ' },
          { name: '/autorole <role>', desc: 'Attribution automatique d\'un rôle à la bienvenue' },
          { name: '/reactionrole <role> <titre>', desc: 'Créer un message à bouton pour récupérer un rôle' },
          { name: '/announce <salon> <titre> <msg>', desc: 'Publier une annonce officielle formatée' },
        ],
      },
      economy: {
        title: '💰 Module Économie & Commerce',
        desc: 'Système bancaire, travail quotidien, boutiques et inventaires.',
        icon: '💰',
        commands: [
          { name: '/balance [membre]', desc: 'Consulter le solde du portefeuille et de la banque' },
          { name: '/daily', desc: 'Réclamer sa récompense quotidienne avec bonus de série' },
          { name: '/work', desc: 'Travailler pour gagner de la monnaie' },
          { name: '/pay <membre> <montant>', desc: 'Envoyer de la monnaie à un autre membre' },
          { name: '/bank <deposit|withdraw>', desc: 'Déposer ou retirer de l\'argent dans votre banque' },
          { name: '/shop <list|buy|add>', desc: 'Consulter la boutique, acheter ou créer des articles' },
          { name: '/inventory [membre]', desc: 'Consulter vos objets et rôles débloqués' },
          { name: '/leaderboard', desc: 'Classement des membres les plus riches du serveur' },
        ],
      },
      games: {
        title: '🎲 Module Jeux & Casino',
        desc: '10 jeux interactifs (roulette, pendu, duel, higher-lower, wordchain...).',
        icon: '🎲',
        commands: [
          { name: '/roulette <mise> <pari>', desc: 'Roulette européenne (rouge/noir/pair/impair ou numéro exact x36)' },
          { name: '/higher-lower <mise>', desc: 'Devinez si la prochaine carte sera plus haute ou plus basse' },
          { name: '/wordchain <start|stop>', desc: 'Jeu multijoueur de chaîne de mots en direct dans le salon' },
          { name: '/hangman <solo|multi>', desc: 'Jeu du Pendu avec visualiseur ASCII (solo ou mot personnalisé)' },
          { name: '/duel <membre> <mise>', desc: 'Défi 1v1 avec mise bloquée en réserve (Coinflip ou Dés)' },
          { name: '/leaderboard-games', desc: 'Classement des meilleurs joueurs et plus grands gains' },
          { name: '/coinflip <mise>', desc: 'Jeu classique de Pile ou Face' },
          { name: '/slots <mise>', desc: 'Machine à sous Flowie avec multiplicateurs' },
          { name: '/rps <mise>', desc: 'Pierre-Feuille-Ciseaux contre le bot' },
        ],
      },
      tickets: {
        title: '🎫 Module Tickets',
        desc: 'Panneaux de tickets personnalisables, salons privés et transcripts.',
        icon: '🎫',
        commands: [
          { name: '/ticket-panel <#salon>', desc: 'Créer un panneau de tickets avec menu déroulant de types' },
          { name: '/ticket close [raison]', desc: 'Fermer un ticket, générer un transcript HTML et supprimer le salon' },
          { name: '/ticket-stats', desc: 'Statistiques complètes des tickets du serveur' },
        ],
      },
      uptimer: {
        title: '⏱️ Module Uptimer & Statuts',
        desc: 'Surveillance en temps réel du statut d\'autres bots et alertes.',
        icon: '⏱️',
        commands: [
          { name: '/uptimer add <bot>', desc: 'Ajouter un bot à la liste de suivi de statut du serveur' },
          { name: '/uptimer remove <bot>', desc: 'Retirer un bot de la liste de suivi' },
          { name: '/uptimer list', desc: 'Afficher la liste et le statut en direct des bots suivis' },
          { name: '/uptimer status <bot>', desc: 'Historique d\'uptime et événements récents d\'un bot' },
          { name: '/uptimer alert <#salon>', desc: 'Configurer le salon d\'alertes automatiques en cas de panne' },
        ],
      },
      giveaways: {
        title: '🎉 Module Giveaways & Concours',
        desc: 'Organisation et tirages au sort de concours interactifs.',
        icon: '🎉',
        commands: [
          { name: '/giveaway start <prix> <duree>', desc: 'Lancer un concours avec bouton d\'inscription 🎉' },
          { name: '/giveaway list', desc: 'Afficher les concours en cours' },
          { name: '/giveaway end <id>', desc: 'Terminer prématurément un concours' },
          { name: '/giveaway reroll <id>', desc: 'Relancer le tirage au sort d\'un gagnant' },
        ],
      },
    };

    // Main Overview Embed
    const mainEmbed = EmbedService.gold(
      '🌲 Centre d Assistance Flowie by Florynx Labs',
      'Bienvenue dans le menu d\'aide de **Flowie** !\n' +
        'Sélectionnez une catégorie dans le menu ci-dessous pour afficher les commandes disponibles et leurs détails.\n\n' +
        '⚡ **Commandes phares** : `/setup`, `/config`, `/roulette`, `/ticket-panel`, `/uptimer`'
    )
      .setImage(HELP_IMAGE_URL)
      .setFooter({ text: `${config.bot.footer.text} • Choisissez une catégorie ci-dessous` });

    // Category Select Menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_category')
      .setPlaceholder('📌 Choisir une catégorie de commandes...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('⚙️ Core & Système').setValue('core').setDescription('Ping, info, botstats, help'),
        new StringSelectMenuOptionBuilder().setLabel('🛡️ Modération & Cases').setValue('moderation').setDescription('Warns, mutes, bans, softbans, purge, cases'),
        new StringSelectMenuOptionBuilder().setLabel('📊 Gestion & Setup').setValue('management').setDescription('/setup, /config, /welcome, autoroles'),
        new StringSelectMenuOptionBuilder().setLabel('💰 Économie & Commerce').setValue('economy').setDescription('Solde, daily, work, boutique, banque'),
        new StringSelectMenuOptionBuilder().setLabel('🎲 Jeux & Casino').setValue('games').setDescription('Roulette, pendu, duel, higher-lower, wordchain'),
        new StringSelectMenuOptionBuilder().setLabel('🎫 Tickets').setValue('tickets').setDescription('Panneaux, salons privés et transcripts'),
        new StringSelectMenuOptionBuilder().setLabel('⏱️ Uptimer & Statuts').setValue('uptimer').setDescription('Surveillance du statut d autres bots'),
        new StringSelectMenuOptionBuilder().setLabel('🎉 Giveaways').setValue('giveaways').setDescription('Organisation et tirages au sort')
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const reply = await interaction.reply({
      embeds: [mainEmbed],
      components: [row],
      fetchReply: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (selectInt) => {
      await selectInt.deferUpdate();

      const selectedCategory = selectInt.values[0];
      const detail = categoryDetails[selectedCategory];

      if (!detail) return;

      const categoryEmbed = EmbedService.gold(
        `${detail.title}`,
        `${detail.desc}\n\n**Commandes du module :**`
      ).setFooter({ text: `${config.bot.footer.text} • ${detail.commands.length} commandes` });

      detail.commands.forEach((cmd) => {
        categoryEmbed.addFields({ name: `\`${cmd.name}\``, value: cmd.desc, inline: false });
      });

      await reply.edit({ embeds: [categoryEmbed], components: [row] });
    });

    collector.on('end', async () => {
      selectMenu.setDisabled(true);
      await reply.edit({ components: [row] }).catch(() => null);
    });
  },
};

export default command;
