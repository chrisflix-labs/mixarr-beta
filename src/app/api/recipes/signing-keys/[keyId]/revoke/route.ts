import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { revokeSigningKey } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request, { params }: { params: { keyId: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.signing_keys.manage", true); return NextResponse.json(await revokeSigningKey(auth.userId, params.keyId)); } catch (error) { return governanceApiError(error, "SIGNING_KEY_REVOKE_FAILED"); } }
