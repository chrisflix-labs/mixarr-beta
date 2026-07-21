import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRecipeCopilotRequest, requireRecipeAiPermission } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function GET(_request: Request, { params }: { params: { requestId: string } }) {
  try { return NextResponse.json(await getRecipeCopilotRequest(recipeCopilotUserId(), params.requestId)); }
  catch (error) { return recipeCopilotApiError(error); }
}
export async function DELETE(_request: Request, { params }: { params: { requestId: string } }) {
  try {
    const userId = recipeCopilotUserId(); const row = await prisma.aiRecipeRequest.findUnique({ where: { id: params.requestId } });
    if (!row) return NextResponse.json({ error: { code: "AI_RECIPE_REQUEST_NOT_FOUND", message: "AI recipe request not found." } }, { status: 404 });
    await requireRecipeAiPermission(userId, "recipe.ai.review", row.ownerId);
    if (!["PREPARING", "WAITING_FOR_PROVIDER", "GENERATING_PROPOSAL", "VALIDATING_RESPONSE"].includes(row.status)) return NextResponse.json({ error: { code: "AI_RECIPE_REQUEST_NOT_CANCELLABLE", message: "This request is no longer running." } }, { status: 409 });
    const request = await prisma.aiRecipeRequest.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date() } });
    return NextResponse.json({ request });
  } catch (error) { return recipeCopilotApiError(error); }
}

