import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { createRecipeExport } from "@/lib/mixRecipes/transferService";

async function exportResponse(userId: string, recipeIds: string[], options: { archive?: boolean; includeArtwork?: boolean; excludeInvalid?: boolean }) {
  try {
    const result = await createRecipeExport({ userId, recipeIds, ...options });
    return new NextResponse(typeof result.output === "string" ? result.output : Buffer.from(result.output), { headers: { "Content-Type": result.binary ? "application/zip" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store", "X-Mixarr-Export-Summary": encodeURIComponent(JSON.stringify({ recipeCount: result.recipeCount, formatVersion: result.formatVersion, artworkCount: result.artworkCount, warnings: result.warnings.length })) } });
  } catch (error) {
    const caught = error as Error & { code?: string; status?: number };
    return NextResponse.json({ error: caught.message, code: caught.code || "EXPORT_FAILED" }, { status: caught.status || 400 });
  }
}

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipes = await prisma.playlistRecipe.findMany({ where: { userId, isArchived: false }, select: { id: true } });
  return exportResponse(userId, recipes.map((recipe) => recipe.id), {});
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const recipeIds = Array.isArray(body.recipeIds) ? body.recipeIds.filter((id: unknown): id is string => typeof id === "string") : [];
  return exportResponse(userId, recipeIds, { archive: body.archive === true, includeArtwork: body.includeArtwork === true, excludeInvalid: body.excludeInvalid === true });
}
