import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { deleteAiProvider, getAiProvider, updateAiProvider } from "@/ai/services/providerService";
import { AiError } from "@/ai/errors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); return NextResponse.json(await getAiProvider(params.providerId)); } catch (error) { return aiRouteError(error); } }
export async function PATCH(request: Request, { params }: { params: { providerId: string } }) { try { const actorId = await requireAiAdmin(); return NextResponse.json(await updateAiProvider(params.providerId, await request.json(), actorId)); } catch (error) { return aiRouteError(error); } }
export async function DELETE(request: Request, { params }: { params: { providerId: string } }) {
  try {
    let actorUserId: string;
    try { actorUserId = await requireAiAdmin(); } catch (error) { if ((error as Error)?.message === "ADMIN_REQUIRED") throw new AiError("AI_PROVIDER_DELETE_FORBIDDEN"); throw error; }
    const suppliedCorrelationId = request.headers.get("x-correlation-id");
    const correlationId = suppliedCorrelationId && /^[a-zA-Z0-9._:-]{1,200}$/.test(suppliedCorrelationId) ? suppliedCorrelationId : crypto.randomUUID();
    return NextResponse.json(await deleteAiProvider({ providerId: params.providerId, actorUserId, correlationId }));
  } catch (error) { return aiRouteError(error); }
}
