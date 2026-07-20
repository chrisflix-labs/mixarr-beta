import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { previewStoredRecipeMigration, runStoredRecipeMigration } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await authorizeSessionOrToken(request, "recipes.migrate");
    return NextResponse.json(await previewStoredRecipeMigration(auth.userId, params.id));
  } catch (error) {
    return governanceApiError(error, "RECIPE_MIGRATION_PREVIEW_FAILED");
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await authorizeSessionOrToken(request, "recipes.migrate");
    const body = await request.json();
    return NextResponse.json(await runStoredRecipeMigration(auth.userId, params.id, String(body.diffHash || "")));
  } catch (error) {
    return governanceApiError(error, "RECIPE_MIGRATION_FAILED");
  }
}
