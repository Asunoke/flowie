import { Message, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { EmbedService } from '../services/embedService.js';
import { BlacklistService } from '../services/blacklistService.js';
import { PlanService } from '../services/planService.js';
import { loadCommands } from '../utils/commandLoader.js';
import { TimeCapsuleService } from '../services/timeCapsuleService.js';

export async function handleOwnerCommand(message: Message): Promise<boolean> {
  const ownerId = process.env.OWNER_ID || config.owner.id;
  const prefix = process.env.OWNER_PREFIX || config.owner.prefix || '!!';

  // 1. Silent Check: Must be the primary owner or a configured sub-owner
  const isOwner = message.author.id === ownerId || config.owner.subOwnerIds.includes(message.author.id);
  if (!isOwner) {
    return false; // Silently ignore, never reveal owner system existence
  }

  // 2. Prefix Check
  if (!message.content.startsWith(prefix)) {
    return false;
  }

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return false;

  logger.info(`[OWNER_COMMAND] Executing !!${commandName} by ${message.author.tag}`);

  let success = false;
  let resultSummary = '';

  try {
    switch (commandName) {
      // ─── 1. EVAL ──────────────────────────────────────────────────────────
      case 'eval': {
        const code = args.join(' ');
        if (!code) {
          await message.reply('❌ Usage: `!!eval <code>`');
          return true;
        }

        const dangerousKeywords = ['process.exit', 'rm', 'DROP', 'deleteMany', 'destroy', 'eval', 'DISCORD_TOKEN', 'token', 'env'];
        const isDangerous = dangerousKeywords.some((kw) => code.includes(kw));

        const runEval = async () => {
          try {
            let evaled = await eval(code);
            if (typeof evaled !== 'string') {
              evaled = (await import('util')).inspect(evaled, { depth: 1 });
            }
            const clean = evaled.replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27}/g, '[REDACTED_TOKEN]');
            const truncated = clean.length > 1900 ? clean.slice(0, 1900) + '...' : clean;
            await message.reply(`\`\`\`js\n${truncated}\n\`\`\``);
            return true;
          } catch (err: any) {
            await message.reply(`❌ **Erreur d'exécution :**\n\`\`\`js\n${err?.stack || err}\n\`\`\``);
            return false;
          }
        };

        if (isDangerous) {
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId('owner_eval_confirm')
              .setLabel('Exécuter le code sensible ⚠️')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId('owner_eval_cancel')
              .setLabel('Annuler ❌')
              .setStyle(ButtonStyle.Secondary)
          );

          const confirmMsg = await message.reply({
            content: '⚠️ **Attention** : Le code contient des mots-clés destructifs ou sensibles. Confirmez l\'exécution :',
            components: [row],
          });

          const collector = confirmMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30_000,
            filter: (i) => i.user.id === message.author.id,
          });

          collector.on('collect', async (btn) => {
            if (btn.customId === 'owner_eval_confirm') {
              await btn.update({ content: '⚡ Exécution en cours...', components: [] });
              success = await runEval();
              resultSummary = success ? 'Code exécuté après confirmation' : 'Erreur code sensible';
            } else {
              await btn.update({ content: '❌ Exécution annulée.', components: [] });
              resultSummary = 'Exécution annulée par l\'owner';
            }
          });
        } else {
          success = await runEval();
          resultSummary = success ? 'Code exécuté' : 'Erreur d\'exécution';
        }
        break;
      }

      // ─── 2. RELOAD ────────────────────────────────────────────────────────
      case 'reload': {
        await loadCommands();
        success = true;
        resultSummary = 'Rechargement des commandes réussi';
        await message.reply('🔄 **Commandes rechargées à chaud avec succès !**');
        break;
      }

      // ─── 3. SHARDINFO ─────────────────────────────────────────────────────
      case 'shardinfo': {
        const mem = process.memoryUsage();
        const memMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
        const ping = message.client.ws.ping;
        const guildsCount = message.client.guilds.cache.size;
        const usersCount = message.client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

        const embed = EmbedService.gold('⚡ Statistiques par Shard (Shard #0)', '')
          .addFields(
            { name: '💾 Mémoire Utilisée (Heap)', value: `\`${memMB} MB\``, inline: true },
            { name: '📡 Latence WebSocket', value: `\`${ping} ms\``, inline: true },
            { name: '🏰 Serveurs gérés', value: `\`${guildsCount}\``, inline: true },
            { name: '👥 Membres gérés', value: `\`${usersCount}\``, inline: true }
          );

        await message.reply({ embeds: [embed] });
        success = true;
        resultSummary = `Shard #0 | Mem: ${memMB}MB | Ping: ${ping}ms`;
        break;
      }

      // ─── 4. GUILDS ────────────────────────────────────────────────────────
      case 'guilds': {
        const search = args.join(' ').toLowerCase();
        let guildsList = Array.from(message.client.guilds.cache.values());

        if (search) {
          guildsList = guildsList.filter(
            (g) => g.name.toLowerCase().includes(search) || g.id.includes(search)
          );
        }

        const lines = guildsList.slice(0, 15).map(
          (g) => `• **${g.name}** (\`${g.id}\`) — **${g.memberCount} membres**`
        );

        const embed = EmbedService.gold(
          `🏰 Liste des Serveurs (${guildsList.length})`,
          lines.length > 0 ? lines.join('\n') : '`Aucun serveur trouvé`'
        );

        await message.reply({ embeds: [embed] });
        success = true;
        resultSummary = `Affiché ${guildsList.length} serveur(s)`;
        break;
      }

      // ─── 5. LEAVEGUILD ────────────────────────────────────────────────────
      case 'leaveguild': {
        const targetGuildId = args[0];
        if (!targetGuildId) {
          await message.reply('❌ Usage: `!!leaveguild <guildId>`');
          return true;
        }

        const targetGuild = message.client.guilds.cache.get(targetGuildId);
        if (!targetGuild) {
          await message.reply(`❌ Serveur \`${targetGuildId}\` introuvable.`);
          return true;
        }

        const name = targetGuild.name;
        await targetGuild.leave();
        await message.reply(`🚪 **Flowie a quitté le serveur "${name}" (\`${targetGuildId}\`).**`);
        success = true;
        resultSummary = `Quitté serveur ${name} (${targetGuildId})`;
        break;
      }

      // ─── 6. BLACKLIST ─────────────────────────────────────────────────────
      case 'blacklist': {
        const action = args[0]?.toLowerCase();
        const targetId = args[1];
        const reason = args.slice(2).join(' ') || 'Aucune raison spécifiée';

        if (!action || !['add', 'remove', 'list'].includes(action)) {
          await message.reply('❌ Usage: `!!blacklist <add|remove|list> [targetId] [raison]`');
          return true;
        }

        if (action === 'list') {
          const entries = await BlacklistService.getBlacklistEntries();
          const lines = entries.map((e: any) => `• **[${e.type.toUpperCase()}]** \`${e.targetId}\` — *${e.reason}*`);
          const embed = EmbedService.gold(
            `🚫 Liste Noire (${entries.length})`,
            lines.length > 0 ? lines.join('\n') : '`La liste noire est vide`'
          );
          await message.reply({ embeds: [embed] });
          success = true;
          return true;
        }

        if (!targetId) {
          await message.reply('❌ Veuillez spécifier un ID d\'utilisateur ou de serveur.');
          return true;
        }

        if (action === 'add') {
          // Detect type (User or Guild)
          const isUser = message.client.users.cache.has(targetId) || !(message.client.guilds.cache.has(targetId));
          const type = isUser ? 'user' : 'guild';

          await BlacklistService.addBlacklist(type, targetId, reason);
          await message.reply(`🚫 **[${type.toUpperCase()}] \`${targetId}\` ajouté à la liste noire !**\n**Raison :** ${reason}`);
          success = true;
          resultSummary = `Blacklist add ${type} ${targetId}`;
        } else if (action === 'remove') {
          await BlacklistService.removeBlacklist(targetId);
          await message.reply(`✅ **\`${targetId}\` retiré de la liste noire.**`);
          success = true;
          resultSummary = `Blacklist remove ${targetId}`;
        }
        break;
      }

      // ─── 6b. PREMIUM ─────────────────────────────────────────────────────
      case 'premium': {
        const action = args[0]?.toLowerCase();
        const targetUserId = args[1];

        if (!action || !['add', 'remove', 'check'].includes(action)) {
          await message.reply('❌ Usage: `!!premium <add|remove|check> <userId> [maxGuilds] [duree_jours]`');
          return true;
        }

        if (!targetUserId) {
          await message.reply('❌ Veuillez spécifier l\'ID Discord de l\'utilisateur.');
          return true;
        }

        if (action === 'add') {
          const maxGuilds = parseInt(args[2], 10) || 5;
          const durationDays = args[3] ? parseInt(args[3], 10) : undefined;

          await PlanService.addPremium(targetUserId, maxGuilds, message.author.id, durationDays);
          const durStr = durationDays ? `${durationDays} jours` : 'Illimitée';
          await message.reply(
            `✨ **\`${targetUserId}\` a été ajouté à la liste Premium !**\n` +
              `• **Nombre max de serveurs** : \`${maxGuilds === -1 ? 'Illimité (-1)' : maxGuilds}\`\n` +
              `• **Durée** : \`${durStr}\``
          );
          success = true;
          resultSummary = `Premium add ${targetUserId} (max: ${maxGuilds})`;
        } else if (action === 'remove') {
          await PlanService.removePremium(targetUserId);
          await message.reply(`✅ **\`${targetUserId}\` retiré de la liste Premium (repasse au plan Free : 1 serveur max).**`);
          success = true;
          resultSummary = `Premium remove ${targetUserId}`;
        } else if (action === 'check') {
          const quota = await PlanService.getQuotaInfo(targetUserId);
          const expStr = quota.expiresAt ? quota.expiresAt.toLocaleDateString('fr-FR') : 'Permanente';
          const embed = EmbedService.gold(
            `✨ Statut Premium — User \`${targetUserId}\``,
            `Informations du plan d'utilisation`
          ).addFields(
            { name: '⭐ Plan', value: quota.isPremium ? '`Premium`' : '`Free`', inline: true },
            { name: '🏰 Serveurs autorisés', value: `\`${quota.maxGuilds === -1 ? 'Illimité' : quota.maxGuilds}\``, inline: true },
            { name: '📊 Serveurs comptés', value: `\`${quota.activeCount}\``, inline: true },
            { name: '📅 Expiration', value: `\`${expStr}\``, inline: true }
          );

          await message.reply({ embeds: [embed] });
          success = true;
          resultSummary = `Premium check ${targetUserId}`;
        }
        break;
      }

      // ─── 7. BROADCAST ─────────────────────────────────────────────────────
      case 'broadcast': {
        const broadcastText = args.join(' ');
        if (!broadcastText) {
          await message.reply('❌ Usage: `!!broadcast <message>`');
          return true;
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('broadcast_confirm')
            .setLabel('Confirmer l\'envoi global 📢')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('broadcast_cancel')
            .setLabel('Annuler ❌')
            .setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await message.reply({
          content: `⚠️ **Confirmation requise** : Souhaitez-vous envoyer cette annonce dans les salons de logs de **tous les serveurs** ?\n\n> ${broadcastText}`,
          components: [row],
        });

        const collector = promptMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 30_000,
          filter: (i) => i.user.id === message.author.id,
        });

        collector.on('collect', async (btn) => {
          if (btn.customId === 'broadcast_confirm') {
            await btn.update({ content: '📢 Diffusion en cours...', components: [] });

            let sentCount = 0;
            const guilds = message.client.guilds.cache.values();

            for (const g of guilds) {
              const channel = g.systemChannel || g.channels.cache.find((c) => c.isTextBased() && 'send' in c);
              if (channel && 'send' in channel) {
                const embed = EmbedService.gold('📢 Annonce Officielle Flowie', broadcastText);
                await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
                sentCount++;
              }
            }

            await promptMsg.edit(`✅ **Annonce diffusée dans ${sentCount} serveur(s) !**`);
            success = true;
            resultSummary = `Broadcast envoyé à ${sentCount} serveurs`;
          } else {
            await btn.update({ content: '❌ Diffusion annulée.', components: [] });
            resultSummary = 'Broadcast annulé par l\'owner';
          }
        });
        break;
      }

      // ─── 8. SETSTATUS ─────────────────────────────────────────────────────
      case 'setstatus': {
        const statusText = args.join(' ');
        if (!statusText) {
          await message.reply('❌ Usage: `!!setstatus <texte>`');
          return true;
        }

        message.client.user?.setActivity(statusText);
        await message.reply(`🎮 **Activité mise à jour :** \`${statusText}\``);
        success = true;
        resultSummary = `Status mis à jour: "${statusText}"`;
        break;
      }

      // ─── 9. STATS-GLOBAL ──────────────────────────────────────────────────
      case 'stats-global': {
        const guildsCount = message.client.guilds.cache.size;
        const usersCount = message.client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
        const uptimeSec = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);

        const embed = EmbedService.gold(
          '🌍 Statistiques Globales Flowie',
          `Informations générales sur l'instance du bot.`
        ).addFields(
          { name: '🏰 Serveurs totaux', value: `\`${guildsCount}\``, inline: true },
          { name: '👥 Membres totaux', value: `\`${usersCount}\``, inline: true },
          { name: '⏱️ Uptime global', value: `\`${hours}h ${mins}m\``, inline: true },
          { name: '⚙️ Node.js', value: `\`${process.version}\``, inline: true },
          { name: '📦 discord.js', value: '`v14.27.0`', inline: true }
        );

        await message.reply({ embeds: [embed] });
        success = true;
        resultSummary = `Stats affichées | Guilds: ${guildsCount} | Uptime: ${hours}h${mins}m`;
        break;
      }

      // ─── 10. TIME CAPSULE FORCE-OPEN ─────────────────────────────────────
      case 'timecapsule':
      case 'force-open': {
        let targetId = args[0];
        if (commandName === 'timecapsule' && args[0] === 'force-open') {
          targetId = args[1];
        }

        if (!targetId) {
          await message.reply('❌ Usage: `!!timecapsule force-open <capsuleId>` ou `!!force-open <capsuleId>`');
          return true;
        }

        try {
          const opened = await TimeCapsuleService.forceOpenCapsule(targetId, message.author.id);

          const embed = EmbedService.gold(
            '⚠️ Ouverture d Urgence (Bot Owner)',
            `La capsule temporelle \`#${opened.id}\` a été forcé-ouverte.`
          ).addFields(
            { name: '🏰 Server ID', value: `\`${opened.guildId}\``, inline: true },
            { name: '👤 Author ID', value: `<@${opened.authorId}> (\`${opened.authorTag}\`)`, inline: true },
            { name: '📜 Contenu Scellé', value: opened.content, inline: false },
            { name: '📅 Date de création', value: `<t:${Math.floor(opened.createdAt.getTime() / 1000)}:f>`, inline: true }
          ).setFooter({ text: `Urgence Moderation • ID: ${opened.id}` });

          await message.reply({ embeds: [embed] });
          success = true;
          resultSummary = `[OWNER_FORCE_OPEN] Capsule ${opened.id} (Guild: ${opened.guildId})`;
        } catch (err: any) {
          await message.reply(`❌ **Erreur d ouverture d urgence :** ${err?.message || err}`);
          success = false;
        }
        break;
      }

      default:
        await message.reply(`❌ Commande owner inconnue : \`!!${commandName}\``);
        return true;
    }

    // Log owner command execution to OWNER_LOG_CHANNEL_ID if configured
    const logChannelId = process.env.OWNER_LOG_CHANNEL_ID || config.owner.logChannelId;
    if (logChannelId) {
      try {
        const logChannel = await message.client.channels.fetch(logChannelId).catch(() => null);
        if (logChannel && logChannel instanceof TextChannel) {
          const logEmbed = EmbedService.create(
            '👑 Exécution de commande Owner',
            `**Commande** : \`!!${commandName}\`\n**Args** : \`${args.join(' ') || 'Aucun'}\`\n**Résultat** : ${resultSummary || 'Terminé'}`,
            0x0B3D2E
          ).setFooter({ text: `Owner ID: ${message.author.id} • ${new Date().toLocaleString('fr-FR')}` });

          await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
        }
      } catch (logErr) {
        logger.error({ err: logErr }, '[OWNER] Failed to log owner command execution');
      }
    }

    return true;
  } catch (err: any) {
    logger.error({ err, commandName }, '[OWNER] Error handling owner command');
    await message.reply(`❌ **Erreur d'exécution :** \`${err?.message || err}\``).catch(() => null);
    return true;
  }
}
