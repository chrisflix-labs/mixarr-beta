import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getOwnedRecipe } from "@/lib/mixRecipes/service";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const recipe = await getOwnedRecipe(userId, params.id);
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
    const [playlists, total] = await Promise.all([
      prisma.generatedPlaylist.findMany({ where: { userId, recipeId: recipe.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, plexPlaylistTitle: true, trackCount: true, recipeVersionUsed: true, createdAt: true, lastGeneratedAt: true } }),
      prisma.generatedPlaylist.count({ where: { userId, recipeId: recipe.id } }),
    ]);
    return NextResponse.json({ playlists, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list playlists." }, { status: 404 });
  }
}

