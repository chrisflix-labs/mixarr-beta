import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { rejectRecipe } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request, { params }: { params: { id: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.approve"); const body = await request.json(); if (!String(body.reason || "").trim()) return NextResponse.json({ error: "A rejection reason is required.", code: "REJECTION_REASON_REQUIRED" }, { status: 400 }); return NextResponse.json({ recipe: await rejectRecipe(auth.userId, params.id, String(body.reason)) }); } catch (error) { return governanceApiError(error, "RECIPE_REJECTION_FAILED"); } }
