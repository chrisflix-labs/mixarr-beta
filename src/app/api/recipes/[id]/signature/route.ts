import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import prisma from "@/lib/prisma";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request, { params }: { params: { id: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.view"); const recipe = await prisma.playlistRecipe.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, signatureStatus: true, signatureAlgorithm: true, signatureKeyId: true, signerIdentity: true, signatureSignedAt: true, trustState: true } }); return recipe ? NextResponse.json({ signature: recipe }) : NextResponse.json({ error: "Recipe not found.", code: "RECIPE_NOT_FOUND" }, { status: 404 }); } catch (error) { return governanceApiError(error); } }
