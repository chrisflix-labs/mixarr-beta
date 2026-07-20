import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { retryRecipeValidation } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request, { params }: { params: { id: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.import"); return NextResponse.json(await retryRecipeValidation(auth.userId, params.id)); } catch (error) { return governanceApiError(error, "RECIPE_REVALIDATION_FAILED"); } }
