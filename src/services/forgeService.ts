import { prisma } from '../database/db.js';
import { EconomyService } from './economyService.js';
import { logger } from '../utils/logger.js';

export interface CraftIngredientInput {
  itemId: string;
  quantity: number;
}

export interface CraftResult {
  success: boolean;
  reason?: 'missing_ingredients' | 'recipe_not_found' | 'transaction_failed';
  isCraftSuccess?: boolean;
  resultItem?: {
    id: string;
    name: string;
    description: string;
    roleId: string | null;
  };
  missingIngredients?: { name: string; required: number; owned: number }[];
  lossType?: string;
  roll?: number;
  successRate?: number;
}

export class ForgeService {
  /**
   * Get all recipes for a guild with ingredients and result item
   */
  static async getRecipes(guildId: string) {
    return await prisma.forgeRecipe.findMany({
      where: { guildId },
      include: {
        resultItem: true,
        ingredients: {
          include: {
            shopItem: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get discovered recipes for a member (or all if guild visibility setting is 'all')
   */
  static async getDiscoveredRecipes(guildId: string, userId: string) {
    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
    });

    const visibility = guild?.forgeVisibility || 'discovered';
    const allRecipes = await this.getRecipes(guildId);

    if (visibility === 'all') {
      return allRecipes;
    }

    // Get member's owned shop item IDs
    const member = await EconomyService.getMember(guildId, userId);
    const inventory = await prisma.inventoryItem.findMany({
      where: { memberId: member.id },
      select: { shopItemId: true },
    });

    const ownedItemIds = new Set(inventory.map((i: { shopItemId: string }) => i.shopItemId));

    // Filter recipes where member owns at least 1 ingredient
    return allRecipes.filter((recipe: any) =>
      recipe.ingredients.some((ing: any) => ownedItemIds.has(ing.itemId))
    );
  }

  /**
   * Get recipe by name (case-insensitive)
   */
  static async getRecipeByName(guildId: string, name: string) {
    const recipes = await this.getRecipes(guildId);
    const searchName = name.trim().toLowerCase();
    return recipes.find((r: any) => r.name.toLowerCase() === searchName || r.id === name);
  }

  /**
   * Create a new forge recipe
   */
  static async createRecipe(data: {
    guildId: string;
    name: string;
    resultItemId: string;
    ingredients: CraftIngredientInput[];
    successRate?: number;
    lossType?: 'total' | 'partial';
    createdBy: string;
  }) {
    const { guildId, name, resultItemId, ingredients, successRate = 100, lossType = 'total', createdBy } = data;

    // Verify result item exists
    const resultItem = await prisma.shopItem.findFirst({
      where: { id: resultItemId, guildId },
    });

    if (!resultItem) {
      throw new Error(`L'article résultat (ID: ${resultItemId}) n'existe pas dans la boutique.`);
    }

    // Verify all ingredients exist
    for (const ing of ingredients) {
      const shopItem = await prisma.shopItem.findFirst({
        where: { id: ing.itemId, guildId },
      });

      if (!shopItem) {
        throw new Error(`L'ingrédient (ID: ${ing.itemId}) n'existe pas dans la boutique.`);
      }
    }

    // Upsert or Create Recipe
    return await prisma.forgeRecipe.create({
      data: {
        guildId,
        name,
        resultItemId,
        successRate: Math.min(100, Math.max(1, successRate)),
        lossType,
        createdBy,
        ingredients: {
          create: ingredients.map((ing) => ({
            itemId: ing.itemId,
            quantity: Math.max(1, ing.quantity),
          })),
        },
      },
      include: {
        resultItem: true,
        ingredients: {
          include: {
            shopItem: true,
          },
        },
      },
    });
  }

  /**
   * Delete a recipe by name or ID
   */
  static async deleteRecipe(guildId: string, nameOrId: string) {
    const recipe = await this.getRecipeByName(guildId, nameOrId);
    if (!recipe) {
      return false;
    }

    await prisma.forgeRecipe.delete({
      where: { id: recipe.id },
    });

    return true;
  }

  /**
   * Atomic Craft Execution inside a Prisma Transaction
   */
  static async craftRecipe(guildId: string, userId: string, recipeId: string): Promise<CraftResult> {
    const recipe = await prisma.forgeRecipe.findFirst({
      where: { id: recipeId, guildId },
      include: {
        resultItem: true,
        ingredients: {
          include: {
            shopItem: true,
          },
        },
      },
    });

    if (!recipe) {
      return { success: false, reason: 'recipe_not_found' };
    }

    const member = await EconomyService.getMember(guildId, userId);

    try {
      return await prisma.$transaction(async (tx: any) => {
        // Fetch current user inventory
        const userInventory = await tx.inventoryItem.findMany({
          where: { memberId: member.id },
          include: { shopItem: true },
        });

        // Group user inventory by shopItemId -> array of inventory item IDs
        const inventoryByItem = new Map<string, string[]>();
        for (const item of userInventory) {
          if (!inventoryByItem.has(item.shopItemId)) {
            inventoryByItem.set(item.shopItemId, []);
          }
          inventoryByItem.get(item.shopItemId)!.push(item.id);
        }

        // Check if user has required quantities
        const missing: { name: string; required: number; owned: number }[] = [];
        for (const ing of recipe.ingredients) {
          const owned = inventoryByItem.get(ing.itemId)?.length || 0;
          if (owned < ing.quantity) {
            missing.push({
              name: ing.shopItem.name,
              required: ing.quantity,
              owned,
            });
          }
        }

        if (missing.length > 0) {
          return {
            success: false,
            reason: 'missing_ingredients',
            missingIngredients: missing,
          };
        }

        // Determine craft success / failure
        const roll = Math.floor(Math.random() * 100) + 1; // 1 - 100
        const isCraftSuccess = roll <= recipe.successRate;

        // Determine how many of each ingredient to delete
        for (const ing of recipe.ingredients) {
          const itemIds = inventoryByItem.get(ing.itemId) || [];
          let qtyToRemove = ing.quantity;

          if (!isCraftSuccess && recipe.lossType === 'partial') {
            qtyToRemove = Math.ceil(ing.quantity / 2);
          }

          const idsToRemove = itemIds.slice(0, qtyToRemove);
          if (idsToRemove.length > 0) {
            await tx.inventoryItem.deleteMany({
              where: {
                id: { in: idsToRemove },
              },
            });
          }
        }

        // If successful, grant result item
        if (isCraftSuccess) {
          await tx.inventoryItem.create({
            data: {
              memberId: member.id,
              shopItemId: recipe.resultItemId,
            },
          });
        }

        // Log the craft event
        await tx.forgeLog.create({
          data: {
            guildId,
            userId,
            recipeId: recipe.id,
            success: isCraftSuccess,
          },
        });

        return {
          success: true,
          isCraftSuccess,
          resultItem: recipe.resultItem,
          lossType: recipe.lossType,
          roll,
          successRate: recipe.successRate,
        };
      });
    } catch (err) {
      logger.error({ err, guildId, userId, recipeId }, '[FORGE] Transaction failed');
      return { success: false, reason: 'transaction_failed' };
    }
  }

  /**
   * Get forge usage statistics for a guild
   */
  static async getStats(guildId: string) {
    const logs = await prisma.forgeLog.findMany({
      where: { guildId },
      include: {
        recipe: {
          include: {
            resultItem: true,
          },
        },
      },
    });

    const totalCrafts = logs.length;
    const totalSuccess = logs.filter((l: any) => l.success).length;
    const totalFailures = totalCrafts - totalSuccess;
    const successRateReal = totalCrafts > 0 ? ((totalSuccess / totalCrafts) * 100).toFixed(1) : '0';

    // Count attempts per recipe
    const recipeMap = new Map<string, { name: string; attempts: number; success: number }>();
    for (const log of logs) {
      if (!log.recipe) continue;
      const key = log.recipe.id;
      if (!recipeMap.has(key)) {
        recipeMap.set(key, { name: log.recipe.name, attempts: 0, success: 0 });
      }
      const entry = recipeMap.get(key)!;
      entry.attempts++;
      if (log.success) entry.success++;
    }

    const sortedRecipes = Array.from(recipeMap.values()).sort((a, b) => b.attempts - a.attempts);

    return {
      totalCrafts,
      totalSuccess,
      totalFailures,
      successRateReal,
      mostAttempted: sortedRecipes[0] || null,
      topRecipes: sortedRecipes.slice(0, 5),
    };
  }

  /**
   * Change forge visibility mode for a guild
   */
  static async setVisibility(guildId: string, visibility: 'discovered' | 'all') {
    return await prisma.guild.update({
      where: { id: guildId },
      data: { forgeVisibility: visibility },
    });
  }
}
