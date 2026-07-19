import prisma from "../prisma";

export async function markBuiltInRecipeUsed(userId: string, recipeId: string, recipeVersion: number) {
  return prisma.builtInRecipePreference.upsert({
    where: { userId_recipeId: { userId, recipeId } },
    create: { userId, recipeId, lastUsedAt: new Date(), lastUsedVersion: recipeVersion, useCount: 1 },
    update: { lastUsedAt: new Date(), lastUsedVersion: recipeVersion, useCount: { increment: 1 } },
  });
}

export async function setBuiltInRecipePreference(userId: string, recipeId: string, patch: { favorite?: boolean; hidden?: boolean }) {
  return prisma.builtInRecipePreference.upsert({
    where: { userId_recipeId: { userId, recipeId } },
    create: { userId, recipeId, favorite: patch.favorite === true, hidden: patch.hidden === true },
    update: patch,
  });
}
