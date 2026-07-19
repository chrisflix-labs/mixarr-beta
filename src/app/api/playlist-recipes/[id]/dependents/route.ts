import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try {
    const recipe = await prisma.playlistRecipe.findFirst({ where: { id: params.id, userId }, select: { id: true } }); if (!recipe) throw new Error("Mix recipe not found.");
    const [recipes, playlists] = await Promise.all([prisma.playlistRecipe.findMany({ where: { userId, baseRecipeId: params.id, isArchived: false, deletedAt: null }, select: { id: true, name: true, updatedAt: true } }), prisma.generatedPlaylist.findMany({ where: { userId, recipeId: params.id }, select: { id: true, plexPlaylistTitle: true, updatedAt: true } })]);
    return NextResponse.json({ recipes, playlists, counts: { recipes: recipes.length, playlists: playlists.length, automations: 0 } });
  } catch (error) { return inheritanceApiError(error); }
}
