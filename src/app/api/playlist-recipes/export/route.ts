import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { buildCanonicalRecipesExport } from "@/lib/playlistRecipeImportExport";

function exportFilename() {
  return `mixarr-recipes-export-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipes = await prisma.playlistRecipe.findMany({
    where: { userId, isArchived: false },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
  });
  const payload = buildCanonicalRecipesExport(recipes);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}
