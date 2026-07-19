import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
const schema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(1000).nullish(), presetId: z.string().uuid().nullish() });
export async function GET() { const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized(); return NextResponse.json({ categories: await prisma.recipeCategory.findMany({ where: { userId, isArchived: false }, include: { preset: true, _count: { select: { recipes: true } } }, orderBy: { name: "asc" } }) }); }
export async function POST(request: Request) { const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized(); try { const body = schema.parse(await request.json()); if (body.presetId) { const preset = await prisma.recipePreset.findFirst({ where: { id: body.presetId, ownerId: userId, type: "CATEGORY", isArchived: false } }); if (!preset) throw new Error("Category preset not found."); } const category = await prisma.recipeCategory.create({ data: { userId, name: body.name, description: body.description || null, presetId: body.presetId || null } }); return NextResponse.json({ category }, { status: 201 }); } catch (error) { return inheritanceApiError(error); } }
