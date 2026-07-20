import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { recipeAuditHistory } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.audit.view"); const url = new URL(request.url); const value = (key: string) => url.searchParams.get(key) || undefined; return NextResponse.json({ events: await recipeAuditHistory(auth.userId, { recipeId: value("recipeId"), eventType: value("eventType"), actorId: value("actorId"), trustState: value("trustState"), riskLevel: value("riskLevel"), from: value("from") ? new Date(value("from")!) : undefined, to: value("to") ? new Date(value("to")!) : undefined }) }); } catch (error) { return governanceApiError(error, "RECIPE_AUDIT_READ_FAILED"); } }
