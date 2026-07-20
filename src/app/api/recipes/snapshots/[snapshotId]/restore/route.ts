import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { restoreSnapshot } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request, { params }: { params: { snapshotId: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.restore"); const body = await request.json().catch(() => ({})); return NextResponse.json(await restoreSnapshot(auth.userId, params.snapshotId, body.confirmConflicts === true)); } catch (error) { return governanceApiError(error, "RECIPE_RESTORE_FAILED"); } }
