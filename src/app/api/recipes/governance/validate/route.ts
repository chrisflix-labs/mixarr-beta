import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { validateRecipe } from "@/lib/mixRecipes/validation";
import { buildRecipeGovernancePlan } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";
import { MAX_RECIPE_JSON_BYTES, parseJsonRejectingDuplicateKeys } from "@/lib/mixRecipes/transfer";

export async function POST(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.import"); const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAX_RECIPE_JSON_BYTES) throw Object.assign(new Error("Recipe JSON exceeds the 5 MB safety limit."), { code: "RECIPE_PAYLOAD_TOO_LARGE", status: 413 }); const body = parseJsonRejectingDuplicateKeys(raw) as any; const validation = validateRecipe(body.recipe ?? body); if (!validation.normalizedRecipe) return NextResponse.json({ validation, plan: null }, { status: 422 }); const plan = await buildRecipeGovernancePlan({ userId: auth.userId, recipe: validation.normalizedRecipe, source: String(body.source || "api"), rawPayload: body.recipe ?? body }); return NextResponse.json({ validation, plan }); } catch (error) { return governanceApiError(error, "RECIPE_VALIDATION_FAILED"); } }
