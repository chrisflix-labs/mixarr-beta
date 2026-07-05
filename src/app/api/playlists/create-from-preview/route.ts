import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTracksToPlex } from "@/lib/playlistService";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import prisma from "@/lib/prisma";
import { markPlaylistRecipeUsed } from "@/lib/playlistRecipes";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, trackIds, savedRuleId, rulesSnapshot, optionsSnapshot, previewId, recipeId, recipeName, filters } = await req.json();

    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName || !trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json({ error: "Invalid preview payload" }, { status: 400 });
    }

    let ownedRecipe: { id: string; name: string } | null = null;
    if (recipeId) {
      ownedRecipe = await prisma.playlistRecipe.findFirst({
        where: { id: recipeId, userId, isArchived: false },
        select: { id: true, name: true },
      });

      if (!ownedRecipe) {
        return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
      }
    }

    const result = await exportTracksToPlex({
      userId,
      name: trimmedName,
      trackIds,
      savedRuleId,
      rulesJson: rulesSnapshot ? JSON.stringify(rulesSnapshot) : undefined,
      optionsJson: optionsSnapshot ? JSON.stringify(optionsSnapshot) : undefined,
    });

    if (ownedRecipe) {
      await markPlaylistRecipeUsed(userId, ownedRecipe.id);
    }

    const resolvedRecipeName = ownedRecipe?.name || recipeName || null;
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist create from preview",
      status: "success",
      trigger: "manual",
      summary: resolvedRecipeName
        ? `Created playlist "${trimmedName}" from recipe "${resolvedRecipeName}" with ${result.trackCount} tracks.`
        : `Created playlist "${trimmedName}" from preview with ${result.trackCount} tracks.`,
      counts: { attempted: trackIds.length, processed: result.trackCount, skipped: Math.max(0, trackIds.length - result.trackCount), failed: 0 },
      metadata: {
        savedRuleId: savedRuleId || null,
        serverId: result.serverId,
        playlistId: result.playlistId || null,
        previewId: previewId || null,
        recipeId: ownedRecipe?.id || recipeId || null,
        recipeName: resolvedRecipeName,
        playlistName: trimmedName,
        trackCount: result.trackCount,
        filters: filters || optionsSnapshot || null,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Create from preview failed:", error.response?.data || error.message);
    const message = error.message || "Failed to create playlist from preview";
    const status = message.includes("not owned") || message.includes("not found") ? 403 : 500;

    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist create from preview",
      status: "failed",
      trigger: "manual",
      summary: "Failed to create playlist from preview. Plex returned an error.",
      counts: { attempted: 0, processed: 0, skipped: 0, failed: 1 },
      error: message,
    });

    return NextResponse.json({ error: message }, { status });
  }
}
