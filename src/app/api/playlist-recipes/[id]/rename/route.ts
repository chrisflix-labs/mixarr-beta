import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return NextResponse.json({ error: "Recipe name is required and must be 120 characters or fewer." }, { status: 400 });
  const existing = await prisma.playlistRecipe.findFirst({ where: { id: params.id, userId, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Mix recipe not found." }, { status: 404 });
  const recipe = await prisma.playlistRecipe.update({ where: { id: existing.id }, data: { name } });
  await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe renamed", status: "completed", trigger: "manual", summary: `Renamed recipe "${existing.name}" to "${recipe.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion } });
  return NextResponse.json({ recipe: { id: recipe.id, name: recipe.name, slug: recipe.slug, recipeVersion: recipe.recipeVersion } });
}
