# 👑 William — Discord Bot (Florynx Labs)

**William** est un bot Discord multifonction professionnel, distribué et hautement scalable développé par **Florynx Labs**. Construit sur des technologies modernes (**discord.js v14**, **TypeScript**, **Prisma/PostgreSQL**, **Redis**), William est conçu pour fonctionner en tant que service central multi-processus (sharding) capable de gérer des milliers de serveurs en simultané.

---

## ✨ Fonctionnalités Principales

- 🛡️ **Modération Avancée & Dossiers de Cas (`/case`, `/softban`, `/purge-user`, `/slowmode`, `/nickname`)** : Système de sanctions avec escalades automatiques, hiérarchie de rôles et journalisation complète.
- 🎫 **Système de Tickets Avancé (`/ticket-panel`, `/ticket`, `/ticket-stats`)** : Panneaux interactifs par menus déroulants, salons privés dédiés, assignation staff et génération de transcripts HTML.
- ⏱️ **Module Uptimer & Surveillance (`/uptimer`)** : Suivi en temps réel du statut de connexion d'autres bots du serveur, calcul d'uptime et alertes automatiques en cas de panne.
- 💰 **Économie & Banque (`/balance`, `/daily`, `/work`, `/pay`, `/shop`, `/inventory`)** : Système monétaire complet avec banque, boutiques et classements.
- 🎲 **Jeux & Casino Avancés (`/roulette`, `/higher-lower`, `/wordchain`, `/hangman`, `/duel`, `/leaderboard-games`)** : 10 jeux d'argent et multijoueurs avec verrous anti-double-clic Redis et détection des gains suspects.
- ⚙️ **Onboarding & Assistant `/setup`** : Assistant interactif pas-à-pas par boutons pour configurer le serveur en 2 minutes.
- 👑 **Module Owner Privé (`!!eval`, `!!reload`, `!!shardinfo`, `!!guilds`, `!!leaveguild`, `!!blacklist`, `!!broadcast`)** : Administration technique sécurisée avec gardes silencieux et liste noire globale.
- ⚡ **Sharding Multi-Processus & Cache Redis** : Lanceur `ShardingManager` distribué, connection pooling Prisma et cache de configuration serveur ultra-rapide (TTL 10m).

---

## 🛠️ Configuration & Fichier `config.json`

En plus des variables d'environnement du fichier `.env`, William utilise un fichier `config.json` à la racine pour la personnalisation globale :

```json
{
  "embed": {
    "footerText": "William • Florynx Labs",
    "footerIconUrl": "https://cdn.discordapp.com/embed/avatars/0.png"
  },
  "economy": {
    "defaultCurrency": "Flow"
  },
  "owners": {
    "primaryOwnerId": "1409277100334252104",
    "subOwnerIds": [
      "123456789012345678"
    ]
  }
}
```

---

## 🚀 Démarrage Rapide

### 1. Installation des dépendances
```bash
pnpm install
```

### 2. Configuration des variables d'environnement (`.env`)
```env
DISCORD_TOKEN=votre_token_bot
CLIENT_ID=votre_client_id
DATABASE_URL="postgresql://william:william_password@localhost:5432/william_db"
REDIS_URL="redis://localhost:6379"
OWNER_ID=votre_id_discord
OWNER_PREFIX=!!
```

### 3. Synchronisation de la Base de Données
```bash
pnpm db:push
```

### 4. Déploiement des Commandes Slash
```bash
pnpm deploy:commands
```

### 5. Lancement en Mode Développement
```bash
pnpm dev
```

---

## 🧪 Tests Unitaires

Exécution de la suite complète Vitest (40+ tests) :
```bash
pnpm test
```

---

## 📦 Structure du Projet

```
flowie/
├── config.json                 # Personnalisation footer, devise par défaut & subOwners
├── prisma/
│   └── schema.prisma           # Schéma PostgreSQL (Guild, Member, Ticket, ModerationCase, etc.)
├── src/
│   ├── index.ts                # Master Process ShardingManager
│   ├── bot.ts                  # Worker Process par Shard
│   ├── commands/               # Commandes Slash (core, moderation, management, economy, games, tickets, uptimer)
│   ├── owner-commands/         # Commandes préfixées réservées aux Owners (!!eval, !!blacklist...)
│   ├── services/               # Services métier (TicketService, UptimerService, GuildConfigService, BlacklistService...)
│   └── utils/                  # Utility helpers & Health HTTP server
└── tests/                      # Suite de tests Vitest
```

---

© **Florynx Labs** — *Born from love. Bound by physics.*
