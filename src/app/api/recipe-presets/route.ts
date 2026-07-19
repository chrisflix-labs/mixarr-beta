import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { RECIPE_PRESET_TYPES } from "@/lib/recipeInheritance/service";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";

const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullish(), type: z.enum(RECIPE_PRESET_TYPES), config: z.record(z.unknown()).default({}), locks: z.record(z.unknown()).default({}) });
export async function GET(request: Request) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  const type = new URL(request.url).searchParams.get("type");
  const presets = await prisma.recipePreset.findMany({ where: { ownerId: userId, isArchived: false, ...(type && RECIPE_PRESET_TYPES.includes(type as any) ? { type } : {}) }, include: { _count: { select: { categories: true, transitionRecipes: true, discoveryRecipes: true, varietyRecipes: true, automationRecipes: true } } }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  return NextResponse.json({ presets: presets.map((preset) => ({ ...preset, dependentCount: preset._count.categories + preset._count.transitionRecipes + preset._count.discoveryRecipes + preset._count.varietyRecipes + preset._count.automationRecipes, lockedFieldCount: Object.keys((preset.locksJson || {}) as object).length })) });
}
export async function POST(request: Request) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { const body = schema.parse(await request.json()); const preset = await prisma.recipePreset.create({ data: { ownerId: userId, name: body.name, description: body.description || null, type: body.type, configJson: body.config as any, locksJson: body.locks as any, versions: { create: { version: 1, configJson: body.config as any, locksJson: body.locks as any, createdById: userId } } } }); await prisma.recipeInheritanceAudit.create({ data: { actorId: userId, action: "PRESET_CREATED", entityType: "RecipePreset", entityId: preset.id, nextJson: body as any } }); return NextResponse.json({ preset }, { status: 201 }); }
  catch (error) { return inheritanceApiError(error); }
}
