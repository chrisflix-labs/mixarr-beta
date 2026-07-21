import { NextResponse } from "next/server";
import { RECIPE_COPILOT_ACTIONS } from "@/lib/recipeCopilot/contracts";
import { runRecipeCopilot } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function POST(request: Request, { params }: { params: { id: string; action: string } }) {
  try {
    if (!RECIPE_COPILOT_ACTIONS.includes(params.action as any) || params.action === "create") return NextResponse.json({ error: { code: "UNKNOWN_AI_RECIPE_ACTION", message: "Unknown Recipe Copilot action." } }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ proposal: await runRecipeCopilot(recipeCopilotUserId(), params.id, { ...body, action: params.action }, request.signal) }, { status: 201 });
  } catch (error) { return recipeCopilotApiError(error); }
}

