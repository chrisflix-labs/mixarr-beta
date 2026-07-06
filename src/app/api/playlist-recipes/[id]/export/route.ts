import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { buildSingleRecipeExport, sanitizeRecipeFilename } from "@/lib/playlistRecipeImportExport";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = await prisma.playlistRecipe.findFirst({
    where: { id: params.id, userId, isArchived: false },
  });

  if (!recipe) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }

  const payload = buildSingleRecipeExport(recipe);
  const filename = `mixarr-recipe-${sanitizeRecipeFilename(recipe.name)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
