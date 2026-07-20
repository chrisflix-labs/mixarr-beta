import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { migrationPreview } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request) { try { await authorizeSessionOrToken(request, "recipes.migrate"); const body = await request.json(); return NextResponse.json(migrationPreview(body.recipe ?? body)); } catch (error) { return governanceApiError(error, "RECIPE_MIGRATION_PREVIEW_FAILED"); } }
