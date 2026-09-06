import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { Command } from '../../types/command.js';
import { ForgeService } from '../../services/forgeService.js';
import { EmbedService } from '../../services/embedService.js';
import { EconomyService } from '../../services/economyService.js';
import { prisma } from '../../database/db.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('forge')
    .setDescription('Atelier de forge industrielle Velcarius (fusion d objets et artisanat)')
    .addSubcommand((sub) =>
      sub
        .setName('craft')
        .setDescription('Fabriquer un objet en combinant des composants de votre inventaire')
        .addStringOption((opt) =>
          opt
            .setName('recette')
            .setDescription('Nom de la recette à fabriquer')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('recipes')
        .setDescription('Consulter les recettes de la forge accessibles sur ce serveur')
    )
    .addSubcommand((sub) =>
      sub
        .setName('recipe')
        .setDescription('Afficher les détails et ingrédients d une recette spécifique')
        .addStringOption((opt) =>
          opt
            .setName('nom')
            .setDescription('Nom de la recette')
            .setRequired(true)
        )
    ),
  category: 'forge',
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // ─── 1. CRAFT SUBCOMMAND ──────────────────────────────────────────────
    if (subcommand === 'craft') {
      const recipeInput = interaction.options.getString('recette', true);
      const recipe = await ForgeService.getRecipeByName(guildId, recipeInput);

      if (!recipe) {
        await interaction.reply({
          embeds: [
            EmbedService.error(
              'Recette introuvable',
              `Aucune recette nommée \`${recipeInput}\` n'existe dans la forge.`
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      // Check member's inventory for stock comparison
      const member = await EconomyService.getMember(guildId, userId);
      const userInventory = await prisma.inventoryItem.findMany({
        where: { memberId: member.id },
      });

      const inventoryCounts = new Map<string, number>();
      for (const item of userInventory) {
        inventoryCounts.set(item.shopItemId, (inventoryCounts.get(item.shopItemId) || 0) + 1);
      }

      let canCraft = true;
      const ingredientLines: string[] = [];

      for (const ing of recipe.ingredients) {
        const owned = inventoryCounts.get(ing.itemId) || 0;
        const hasEnough = owned >= ing.quantity;
        if (!hasEnough) canCraft = false;

        const icon = hasEnough ? '✅' : '❌';
        ingredientLines.push(
          `${icon} **${ing.shopItem.name}** : \`${owned} / ${ing.quantity}\` requis`
        );
      }

      // If user lacks ingredients, reject immediately
      if (!canCraft) {
        const embed = EmbedService.warning(
          '🧱 Composants insuffisants — Atelier de Velcarius',
          `Vous n'avez pas tous les composants nécessaires dans votre inventaire pour forger **${recipe.resultItem.name}**.`
        ).addFields(
          { name: '📜 Recette', value: `\`${recipe.name}\``, inline: true },
          { name: '📦 Résultat visé', value: `**${recipe.resultItem.name}**`, inline: true },
          { name: '🧱 État des composants', value: ingredientLines.join('\n'), inline: false }
        );

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      // Prepare Craft Confirmation Embed
      const prepEmbed = EmbedService.gold(
        '⚒️ Atelier de Velcarius — Préparation de la Forge',
        `Vous êtes sur le point de verser vos composants dans les hauts-fourneaux pour forger **${recipe.resultItem.name}**.`
      ).addFields(
        { name: '📜 Nom de la Recette', value: `\`${recipe.name}\``, inline: true },
        { name: '📦 Objet Résultat', value: `**${recipe.resultItem.name}**\n*${recipe.resultItem.description}*`, inline: true },
        {
          name: '🎲 Taux de Réussite',
          value: `\`${recipe.successRate}%\` ${recipe.successRate < 100 ? `*(Perte ${recipe.lossType === 'total' ? 'totale' : 'partielle (50%)'} en cas d'échec)*` : '*(Réussite garantie)*'}`,
          inline: false,
        },
        { name: '🧱 Composants qui seront consommés', value: ingredientLines.join('\n'), inline: false }
      ).setFooter({ text: 'Atelier de Forge Velcarius • Confirmation requise' });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('forge_confirm')
          .setLabel('🔥 Lancer la Forge')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('forge_cancel')
          .setLabel('❌ Annuler')
          .setStyle(ButtonStyle.Secondary)
      );

      const reply = await interaction.reply({
        embeds: [prepEmbed],
        components: [row],
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30_000,
        filter: (i) => i.user.id === userId,
      });

      collector.on('collect', async (btnInt) => {
        if (btnInt.customId === 'forge_cancel') {
          await btnInt.update({
            embeds: [
              EmbedService.warning(
                '❌ Forge Annulée',
                'Le processus de fusion a été interrompu. Vos composants restent intacts dans votre inventaire.'
              ),
            ],
            components: [],
          });
          return;
        }

        if (btnInt.customId === 'forge_confirm') {
          await btnInt.update({
            embeds: [
              EmbedService.gold(
                '⚙️ Fusion en cours...',
                'Les hauts-fourneaux chauffent à blanc... Injection des composants et martelage du métal...'
              ),
            ],
            components: [],
          });

          // Perform atomic craft
          const result = await ForgeService.craftRecipe(guildId, userId, recipe.id);

          if (!result.success) {
            if (result.reason === 'missing_ingredients') {
              await interaction.editReply({
                embeds: [
                  EmbedService.error(
                    '❌ Échec de la Forge',
                    'Vos ingrédients ont changé durant la validation. Le craft a été annulé sans perte.'
                  ),
                ],
              });
            } else {
              await interaction.editReply({
                embeds: [
                  EmbedService.error(
                    '❌ Erreur Système',
                    'Une erreur technique s est produite pendant la transaction. Aucun composant n a été retiré.'
                  ),
                ],
              });
            }
            return;
          }

          // Successful Craft
          if (result.isCraftSuccess) {
            const successEmbed = EmbedService.success(
              '✨ CRAFT RÉUSSI — Forge de Velcarius',
              `🎉 **Félicitations !** Les métaux se sont assemblés en parfaite harmonie dans l atelier.\n\n` +
                `Vous avez créé **${result.resultItem?.name}** !\n` +
                `*${result.resultItem?.description}*`
            ).addFields(
              { name: '📦 Inventaire', value: 'L objet a été ajouté à votre `/inventory`.', inline: true },
              { name: '🎲 Résultat du Tirage', value: `\`${result.roll} / 100\` (Taux: ${result.successRate}%)`, inline: true }
            );

            // Grant role if result shopItem specifies one
            if (result.resultItem?.roleId && interaction.guild) {
              const guildMember = await interaction.guild.members.fetch(userId).catch(() => null);
              const role = interaction.guild.roles.cache.get(result.resultItem.roleId);
              if (guildMember && role) {
                await guildMember.roles.add(role).catch(() => null);
                successEmbed.addFields({ name: '🎭 Rôle Débloqué', value: `<@&${role.id}> a été attribué !`, inline: false });
              }
            }

            await interaction.editReply({ embeds: [successEmbed] });
          } else {
            // Failed Craft
            const failureEmbed = EmbedService.error(
              '💥 CRAFT ÉCHOUÉ — Explosion de la Forge',
              `🔥 **La réaction s est emballée !** Le métal en fusion n a pas pu se stabiliser.\n\n` +
                `• **Tirage** : \`${result.roll} / 100\` (Requis: ≤ ${result.successRate}%)\n` +
                `• **Sanction** : Perte **${result.lossType === 'total' ? 'totale (100%)' : 'partielle (50%)'}** des composants engagés.`
            ).setFooter({ text: 'Atelier de Forge Velcarius • Retentez votre chance !' });

            await interaction.editReply({ embeds: [failureEmbed] });
          }
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          row.components.forEach((c) => c.setDisabled(true));
          await reply.edit({ components: [row] }).catch(() => null);
        }
      });

      return;
    }

    // ─── 2. RECIPES SUBCOMMAND ─────────────────────────────────────────────
    if (subcommand === 'recipes') {
      const recipes = await ForgeService.getDiscoveredRecipes(guildId, userId);

      if (recipes.length === 0) {
        await interaction.reply({
          embeds: [
            EmbedService.warning(
              '📜 Aucune Recette Découverte',
              'Vous ne possédez aucun composant permettant de révéler une recette de forge.\n' +
                'Achetez des articles en boutique (`/shop list`) pour débloquer des recettes dans votre atelier !'
            ),
          ],
        });
        return;
      }

      const embed = EmbedService.gold(
        `📜 Livre de Recettes — Forge de Velcarius (${recipes.length})`,
        'Voici les recettes de forge disponibles et découvertes :'
      );

      for (const r of recipes) {
        const ingredientsList = r.ingredients
          .map((ing: any) => `• ${ing.quantity}x **${ing.shopItem.name}**`)
          .join('\n');

        embed.addFields({
          name: `⚒️ ${r.name} ➡️ ${r.resultItem.name} (Taux: ${r.successRate}%)`,
          value: `**Ingrédients :**\n${ingredientsList}\n*Tapez \`/forge craft recette:${r.name}\` pour fabriquer.*`,
        });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ─── 3. RECIPE DETAILS SUBCOMMAND ─────────────────────────────────────
    if (subcommand === 'recipe') {
      const recipeName = interaction.options.getString('nom', true);
      const recipe = await ForgeService.getRecipeByName(guildId, recipeName);

      if (!recipe) {
        await interaction.reply({
          embeds: [
            EmbedService.error('Recette introuvable', `Aucune recette nommée \`${recipeName}\` n existe.`),
          ],
          ephemeral: true,
        });
        return;
      }

      const member = await EconomyService.getMember(guildId, userId);
      const userInventory = await prisma.inventoryItem.findMany({
        where: { memberId: member.id },
      });

      const inventoryCounts = new Map<string, number>();
      for (const item of userInventory) {
        inventoryCounts.set(item.shopItemId, (inventoryCounts.get(item.shopItemId) || 0) + 1);
      }

      const ingredientDetails = recipe.ingredients.map((ing: any) => {
        const owned = inventoryCounts.get(ing.itemId) || 0;
        const status = owned >= ing.quantity ? '✅ Possédé' : '❌ Manquant';
        return `• **${ing.shopItem.name}** : \`${owned} / ${ing.quantity}\` (${status})`;
      });

      const embed = EmbedService.gold(
        `📜 Fiche de Recette — ${recipe.name}`,
        `Détails complets de la fusion d atelier`
      ).addFields(
        { name: '📦 Objet Résultat', value: `**${recipe.resultItem.name}**\n${recipe.resultItem.description}`, inline: false },
        { name: '🎲 Taux de Succès', value: `\`${recipe.successRate}%\``, inline: true },
        { name: '💥 Type de Perte (en cas d échec)', value: `\`${recipe.lossType === 'total' ? 'Perte Totale' : 'Perte Partielle (50%)'}\``, inline: true },
        { name: '🧱 Ingrédients Requis & Votre Stock', value: ingredientDetails.join('\n'), inline: false }
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
