import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { previewRestore } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request, { params }: { params: { snapshotId: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.restore"); return NextResponse.json(await previewRestore(auth.userId, params.snapshotId)); } catch (error) { return governanceApiError(error, "RECIPE_RESTORE_PREVIEW_FAILED"); } }
