import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
export async function GET(_request: Request, { params }: { params: { id: string } }) { const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized(); try { const preset = await prisma.recipePreset.findFirst({ where: { id: params.id, ownerId: userId }, select: { id: true } }); if (!preset) throw new Error("Recipe preset not found."); return NextResponse.json({ versions: await prisma.recipePresetVersion.findMany({ where: { presetId: params.id }, orderBy: { version: "desc" } }) }); } catch (error) { return inheritanceApiError(error); } }
