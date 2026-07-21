import { NextResponse } from "next/server";
import { applyRecipeCopilotProposal, changeRecipeCopilotProposalStatus, restoreRecipeBeforeAiProposal, validateRecipeCopilotProposal } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function POST(request: Request, { params }: { params: { proposalId: string; operation: string } }) {
  try {
    const userId = recipeCopilotUserId(); const body = await request.json().catch(() => ({}));
    if (params.operation === "apply") return NextResponse.json(await applyRecipeCopilotProposal(userId, params.proposalId, body));
    if (params.operation === "validate") return NextResponse.json({ proposal: await validateRecipeCopilotProposal(userId, params.proposalId) });
    if (params.operation === "restore") return NextResponse.json(await restoreRecipeBeforeAiProposal(userId, params.proposalId));
    if (["approve", "reject", "quarantine"].includes(params.operation)) return NextResponse.json({ proposal: await changeRecipeCopilotProposalStatus(userId, params.proposalId, params.operation as any, body) });
    return NextResponse.json({ error: { code: "UNKNOWN_AI_RECIPE_OPERATION", message: "Unknown AI recipe proposal operation." } }, { status: 404 });
  } catch (error) { return recipeCopilotApiError(error); }
}

