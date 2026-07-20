import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { runStoredRecipeMigration } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.migrate"); const body = await request.json(); return NextResponse.json(await runStoredRecipeMigration(auth.userId, String(body.recipeId || ""), String(body.diffHash || ""))); } catch (error) { return governanceApiError(error, "RECIPE_MIGRATION_FAILED"); } }
