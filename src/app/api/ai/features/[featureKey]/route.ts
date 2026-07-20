import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { updateAiFeature } from "@/ai/services/settingsService";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: { featureKey: string } }) { try { await requireAiAdmin(); return NextResponse.json(await updateAiFeature(params.featureKey, await request.json())); } catch (error) { return aiRouteError(error); } }
