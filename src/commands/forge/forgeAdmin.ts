import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/command.js';
import { ForgeService } from '../../services/forgeService.js';
import { EmbedService } from '../../services/embedService.js';
import { prisma } from '../../database/db.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('forge-admin')
    .setDescription('Administration de l atelier de forge (Staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Créer une nouvelle recette de forge pour le serveur')
        .addStringOption((opt) => opt.setName('nom').setDescription('Nom unique de la recette').setRequired(true))
        .addStringOption((opt) => opt.setName('resultat_item_id').setDescription('ID de l article résultat (ShopItem ID)').setRequired(true))
        .addStringOption((opt) => opt.setName('ingredient1_id').setDescription('ID du 1er composant').setRequired(true))
        .addIntegerOption((opt) => opt.setName('quantite1').setDescription('Quantité du 1er composant').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('ingredient2_id').setDescription('ID du 2ème composant').setRequired(true))
        .addIntegerOption((opt) => opt.setName('quantite2').setDescription('Quantité du 2ème composant').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('ingredient3_id').setDescription('ID du 3ème composant (optionnel)'))
        .addIntegerOption((opt) => opt.setName('quantite3').setDescription('Quantité du 3ème composant').setMinValue(1))
        .addIntegerOption((opt) => opt.setName('taux_succes').setDescription('Taux de succès de la fusion en % (1-100, défaut: 100)').setMinValue(1).setMaxValue(100))
        .addStringOption((opt) =>
          opt
            .setName('type_perte')
            .setDescription('Sanction en cas d échec (défaut: totale)')
            .addChoices(
              { name: 'Perte totale (100% des ingrédients)', value: 'total' },
              { name: 'Perte partielle (50% des ingrédients)', value: 'partial' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Supprimer une recette de forge')
        .addStringOption((opt) => opt.setName('recette').setDescription('Nom de la recette à supprimer').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Consulter les statistiques d utilisation de la forge sur ce serveur')
    ),
  category: 'forge',
  userPermissions: [PermissionFlagsBits.Administrator],
  cooldown: 3,

  async execute(interaction) {
    if (!interaction.guild) return;

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ─── 1. CREATE RECIPE ─────────────────────────────────────────────────
    if (subcommand === 'create') {
      const name = interaction.options.getString('nom', true).trim();
      const resultItemIdInput = interaction.options.getString('resultat_item_id', true).trim();
      const ing1IdInput = interaction.options.getString('ingredient1_id', true).trim();
      const qty1 = interaction.options.getInteger('quantite1', true);
      const ing2IdInput = interaction.options.getString('ingredient2_id', true).trim();
      const qty2 = interaction.options.getInteger('quantite2', true);

      const ing3IdInput = interaction.options.getString('ingredient3_id')?.trim();
      const qty3 = interaction.options.getInteger('quantite3') || 1;

      const successRate = interaction.options.getInteger('taux_succes') || 100;
      const lossType = (interaction.options.getString('type_perte') as 'total' | 'partial') || 'total';

      // Resolve ShopItem IDs (support exact ID or prefix search)
      const shopItems = await prisma.shopItem.findMany({ where: { guildId } });

      const findShopItem = (input: string) =>
        shopItems.find((i: any) => i.id === input || i.id.startsWith(input) || i.name.toLowerCase() === input.toLowerCase());

      const resultItem = findShopItem(resultItemIdInput);
      const ing1 = findShopItem(ing1IdInput);
      const ing2 = findShopItem(ing2IdInput);
      const ing3 = ing3IdInput ? findShopItem(ing3IdInput) : null;

      if (!resultItem) {
        await interaction.reply({
          embeds: [EmbedService.error('Article résultat introuvable', `Aucun article de boutique ne correspond à \`${resultItemIdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      if (!ing1) {
        await interaction.reply({
          embeds: [EmbedService.error('Ingrédient 1 introuvable', `Aucun article de boutique ne correspond à \`${ing1IdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      if (!ing2) {
        await interaction.reply({
          embeds: [EmbedService.error('Ingrédient 2 introuvable', `Aucun article de boutique ne correspond à \`${ing2IdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      if (ing3IdInput && !ing3) {
        await interaction.reply({
          embeds: [EmbedService.error('Ingrédient 3 introuvable', `Aucun article de boutique ne correspond à \`${ing3IdInput}\`.`)],
          ephemeral: true,
        });
        return;
      }

      const ingredientsList = [
        { itemId: ing1.id, quantity: qty1 },
        { itemId: ing2.id, quantity: qty2 },
      ];

      if (ing3) {
        ingredientsList.push({ itemId: ing3.id, quantity: qty3 });
      }

      try {
        const recipe = await ForgeService.createRecipe({
          guildId,
          name,
          resultItemId: resultItem.id,
          ingredients: ingredientsList,
          successRate,
          lossType,
          createdBy: interaction.user.id,
        });

        const ingDisplay = recipe.ingredients
          .map((ing: any) => `• **${ing.shopItem.name}** × ${ing.quantity}`)
          .join('\n');

        const embed = EmbedService.success(
          '⚒️ Recette de Forge Créée',
          `La recette **${recipe.name}** a été enregistrée dans la forge de Velcarius !`
        ).addFields(
          { name: '📦 Résultat', value: `**${resultItem.name}** (ID: \`${resultItem.id}\`)`, inline: true },
          { name: '🎲 Taux de succès', value: `\`${successRate}%\``, inline: true },
          { name: '💥 Type de perte', value: `\`${lossType === 'total' ? 'Totale' : 'Partielle (50%)'}\``, inline: true },
          { name: '🧱 Ingrédients Requis', value: ingDisplay, inline: false }
        );

        await interaction.reply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.reply({
          embeds: [EmbedService.error('Erreur de Création', err?.message || 'Une erreur est survenue.')],
          ephemeral: true,
        });
      }

      return;
    }

    // ─── 2. DELETE RECIPE ─────────────────────────────────────────────────
    if (subcommand === 'delete') {
      const recipeName = interaction.options.getString('recette', true);
      const deleted = await ForgeService.deleteRecipe(guildId, recipeName);

      if (!deleted) {
        await interaction.reply({
          embeds: [EmbedService.error('Recette introuvable', `Aucune recette nommée \`${recipeName}\` n existe.`)],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [EmbedService.success('Recette Supprimée', `La recette **${recipeName}** a été retirée de la forge.`)],
      });
      return;
    }

    // ─── 3. FORGE STATS ───────────────────────────────────────────────────
    if (subcommand === 'stats') {
      const stats = await ForgeService.getStats(guildId);

      const embed = EmbedService.gold(
        `📊 Statistiques de la Forge — ${interaction.guild.name}`,
        'Rapport d utilisation et performances de l atelier Velcarius'
      ).addFields(
        { name: '⚒️ Tentatives Totales', value: `\`${stats.totalCrafts}\``, inline: true },
        { name: '✨ Réussites Totales', value: `\`${stats.totalSuccess}\``, inline: true },
        { name: '💥 Échecs Totaux', value: `\`${stats.totalFailures}\``, inline: true },
        { name: '📈 Taux de Réussite Réel', value: `\`${stats.successRateReal}%\``, inline: true }
      );

      if (stats.mostAttempted) {
        embed.addFields({
          name: '🏆 Recette la Plus Tentée',
          value: `**${stats.mostAttempted.name}** (\`${stats.mostAttempted.attempts} tentatives\` — ${stats.mostAttempted.success} réussites)`,
          inline: false,
        });
      }

      if (stats.topRecipes.length > 0) {
        const topLines = stats.topRecipes.map(
          (r: any, idx: number) => `${idx + 1}. **${r.name}** — ${r.attempts} tentatives (${((r.success / r.attempts) * 100).toFixed(0)}% succès)`
        );
        embed.addFields({ name: '📜 Top 5 Recettes Prisées', value: topLines.join('\n'), inline: false });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
