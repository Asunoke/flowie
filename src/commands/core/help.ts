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
      music: {
        title: '🎵 Module Musique',
        desc: 'Lecteur audio haute qualité avec Shoukaku et Kazagumo.',
        icon: '🎵',
        commands: [
          { name: '/play <recherche/url>', desc: 'Jouer ou ajouter une musique/playlist à la file d\'attente' },
          { name: '/pause', desc: 'Mettre en pause la lecture audio' },
          { name: '/resume', desc: 'Reprendre la lecture audio' },
          { name: '/skip', desc: 'Passer à la musique suivante' },
          { name: '/stop', desc: 'Arrêter la lecture et déconnecter le bot du vocal' },
          { name: '/queue', desc: 'Afficher la file d\'attente musicale' },
          { name: '/nowplaying', desc: 'Afficher les informations du titre en cours' },
          { name: '/volume <1-100>', desc: 'Ajuster le volume de la lecture' },
          { name: '/loop <off|track|queue>', desc: 'Changer le mode de répétition' },
          { name: '/shuffle', desc: 'Mélanger la file d\'attente' },
          { name: '/lyrics', desc: 'Rechercher les paroles du titre en cours' },
          { name: '/playlist', desc: 'Gérer vos playlists personnalisées' },
          { name: '/alwayson', desc: 'Maintenir le bot connecté au vocal 24/7' },
        ],
      },
      leveling: {
        title: '⭐ Module Niveaux & XP',
        desc: 'Système d\'expérience textuelle et vocale avec cartes de niveau et récompenses.',
        icon: '⭐',
        commands: [
          { name: '/rank [membre]', desc: 'Afficher votre carte de niveau et votre progression XP' },
          { name: '/leaderboard-xp', desc: 'Classement des membres les plus actifs du serveur' },
          { name: '/level-roles', desc: 'Configuration des rôles de récompense par niveau' },
        ],
      },
      tempvoice: {
        title: '🔊 Module Salons Vocaux Temporaires',
        desc: 'Création dynamique et gestion autonome de salons vocaux privés.',
        icon: '🔊',
        commands: [
          { name: '/tempvoice setup', desc: 'Créer le salon générateur « Clique pour créer »' },
          { name: '/voice name <nom>', desc: 'Renommer votre salon vocal temporaire' },
          { name: '/voice limit <nombre>', desc: 'Définir la limite d\'utilisateurs dans votre salon' },
          { name: '/voice lock / unlock', desc: 'Verrouiller ou déverrouiller l\'accès à votre salon' },
          { name: '/voice trust / permit / reject', desc: 'Gérer la liste blanche et d\'exclusion de votre salon' },
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
      invites: {
        title: '✉️ Module Invitations & Traçabilité',
        desc: 'Suivi détaillé de qui a invité qui avec bonus et classements.',
        icon: '✉️',
        commands: [
          { name: '/invites [membre]', desc: 'Afficher les statistiques d\'invitations d\'un membre' },
          { name: '/invites-leaderboard', desc: 'Classement des meilleurs inviteurs du serveur' },
          { name: '/invites-who <membre>', desc: 'Savoir qui a invité un membre spécifique' },
          { name: '/invites-bonus <membre> <bonus>', desc: 'Ajouter ou retirer des invitations bonus (Admin)' },
          { name: '/invites-reset', desc: 'Réinitialiser les compteurs d\'invitations' },
        ],
      },
      notify: {
        title: '📢 Notifications Streaming & Médias',
        desc: 'Alertes automatiques en direct pour Twitch et YouTube.',
        icon: '📢',
        commands: [
          { name: '/notify-twitch add|remove|list', desc: 'Gérer les alertes de streams Twitch en direct' },
          { name: '/notify-youtube add|remove|list', desc: 'Gérer les alertes de nouvelles vidéos YouTube' },
        ],
      },
      news: {
        title: '📰 Actualités, Météo & Crypto',
        desc: 'Flux d\'informations RSS, météo et suivi des cours de crypto-monnaies.',
        icon: '📰',
        commands: [
          { name: '/news [categorie]', desc: 'Consulter les dernières actualités en direct' },
          { name: '/news-subscribe <salon>', desc: 'S\'abonner aux fils d\'actualités automatiques' },
          { name: '/news-unsubscribe', desc: 'Se désabonner des fils d\'actualités' },
          { name: '/crypto <symbole>', desc: 'Afficher le cours et la courbe d\'une crypto-monnaie (ex: BTC, ETH)' },
          { name: '/weather <ville>', desc: 'Afficher la météo et prévisions d\'une ville' },
        ],
      },
      birthday: {
        title: '🎂 Module Anniversaires',
        desc: 'Enregistrement et annonces automatiques d\'anniversaires à minuit.',
        icon: '🎂',
        commands: [
          { name: '/birthday set <date>', desc: 'Enregistrer sa date d\'anniversaire (JJ/MM)' },
          { name: '/birthday list', desc: 'Voir les prochains anniversaires du serveur' },
          { name: '/config-birthday <#salon> <role>', desc: 'Configurer le salon d\'annonce et le rôle temporaire' },
        ],
      },
      apply: {
        title: '📝 Recrutements & Candidatures',
        desc: 'Formulaires interactifs de recrutement par bouton et salons d\'évaluation.',
        icon: '📝',
        commands: [
          { name: '/apply', desc: 'Postuler à un rôle ouvert via le formulaire interactif' },
          { name: '/apply-setup <titre> <salon>', desc: 'Créer un panneau de recrutement avec questions personnalisées' },
        ],
      },
      confess: {
        title: '🤫 Confessions Anonymes',
        desc: 'Envoi et modération de confessions 100% anonymes.',
        icon: '🤫',
        commands: [
          { name: '/confess <message>', desc: 'Envoyer une confession anonyme dans le salon dédié' },
          { name: '/config-confess <#salon>', desc: 'Définir le salon de réception des confessions' },
          { name: '/confess-modlog <#salon>', desc: 'Définir le salon privé de modération/logs des confessions' },
        ],
      },
      embed: {
        title: '🎨 Créateur d Embeds',
        desc: 'Générateur et éditeur d\'embeds riches et personnalisés.',
        icon: '🎨',
        commands: [
          { name: '/embed create', desc: 'Créer et publier un message embed personnalisé avec boutons/liens' },
        ],
      },
      verify: {
        title: '🔒 Système de Vérification Captcha',
        desc: 'Vérification anti-bot par image Captcha ou bouton de validation.',
        icon: '🔒',
        commands: [
          { name: '/verify setup', desc: 'Configurer le salon et le rôle de vérification des membres' },
        ],
      },
      counting: {
        title: '🔢 Jeu du Comptage (Counting)',
        desc: 'Jeu communautaire de comptage collaboratif sans erreur.',
        icon: '🔢',
        commands: [
          { name: '/counting setup <#salon>', desc: 'Configurer le salon de jeu de comptage collaboratif' },
        ],
      },
      report: {
        title: '🚨 Signalements de Membres',
        desc: 'Système de signalement discret vers l\'équipe de modération.',
        icon: '🚨',
        commands: [
          { name: '/report <membre> <raison>', desc: 'Signaler un membre suspect au staff' },
          { name: '/config-report <#salon>', desc: 'Définir le salon de réception des signalements' },
        ],
      },
    };

    // Main Overview Embed
    const mainEmbed = EmbedService.gold(
      '🌲 Centre d Assistance Flowie by Florynx Labs',
      'Bienvenue dans le menu d\'aide de **Flowie** !\n' +
        'Sélectionnez une catégorie dans le menu ci-dessous pour afficher les commandes disponibles et leurs détails.\n\n' +
        '⚡ **Commandes phares** : `/setup`, `/config`, `/play`, `/roulette`, `/ticket-panel`, `/uptimer`, `/rank`'
    )
      .setImage(HELP_IMAGE_URL)
      .setFooter({ text: `${config.bot.footer.text} • 21 modules disponibles` });

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
        new StringSelectMenuOptionBuilder().setLabel('🎵 Musique').setValue('music').setDescription('Play, pause, skip, queue, playlists 24/7'),
        new StringSelectMenuOptionBuilder().setLabel('⭐ Niveaux & XP').setValue('leveling').setDescription('Cartes de niveau /rank, classements XP'),
        new StringSelectMenuOptionBuilder().setLabel('🔊 Salons Vocaux Temp.').setValue('tempvoice').setDescription('Salons vocaux privés autonomes'),
        new StringSelectMenuOptionBuilder().setLabel('🎫 Tickets').setValue('tickets').setDescription('Panneaux, salons privés et transcripts'),
        new StringSelectMenuOptionBuilder().setLabel('⏱️ Uptimer & Statuts').setValue('uptimer').setDescription('Surveillance du statut d autres bots'),
        new StringSelectMenuOptionBuilder().setLabel('🎉 Giveaways').setValue('giveaways').setDescription('Organisation et tirages au sort'),
        new StringSelectMenuOptionBuilder().setLabel('✉️ Invitations').setValue('invites').setDescription('Suivi des invitations, classement, bonus'),
        new StringSelectMenuOptionBuilder().setLabel('📢 Notifications Live').setValue('notify').setDescription('Alertes Twitch et YouTube'),
        new StringSelectMenuOptionBuilder().setLabel('📰 News & Crypto').setValue('news').setDescription('Flux d actu, cours crypto et météo'),
        new StringSelectMenuOptionBuilder().setLabel('🎂 Anniversaires').setValue('birthday').setDescription('Enregistrement et annonces auto'),
        new StringSelectMenuOptionBuilder().setLabel('📝 Recrutements').setValue('apply').setDescription('Formulaires de candidature interactifs'),
        new StringSelectMenuOptionBuilder().setLabel('🤫 Confessions').setValue('confess').setDescription('Confessions 100% anonymes'),
        new StringSelectMenuOptionBuilder().setLabel('🎨 Créateur Embeds').setValue('embed').setDescription('Générateur d embeds personnalisés'),
        new StringSelectMenuOptionBuilder().setLabel('🔒 Vérification Captcha').setValue('verify').setDescription('Système anti-bot par Captcha/Bouton'),
        new StringSelectMenuOptionBuilder().setLabel('🔢 Comptage').setValue('counting').setDescription('Jeu de comptage collaboratif'),
        new StringSelectMenuOptionBuilder().setLabel('🚨 Signalements').setValue('report').setDescription('Signalements discrets vers le staff')
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
