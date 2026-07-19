import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationActivityEvent } from "@/lib/orchestration/operations";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = orchestrationSession();
  if (!userId) return orchestrationUnauthorized();
  try {
    const event = await getOrchestrationActivityEvent(userId, params.id);
    return event
      ? NextResponse.json(event)
      : NextResponse.json({ error: { code: "NOT_FOUND", message: "Audit event not found." } }, { status: 404 });
  } catch (error) {
    return orchestrationApiError(error);
  }
}
