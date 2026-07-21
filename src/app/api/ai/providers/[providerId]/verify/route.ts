import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { verifyAiProviderCredentials } from "@/ai/health/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { providerId: string } }) {
  try { const userId = await requireAiAdmin(); return NextResponse.json(await verifyAiProviderCredentials(params.providerId, request.signal, userId)); }
  catch (error) { return aiRouteError(error); }
}
