import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recalculateAutomationProposal } from "@/lib/automation";

export async function POST(_request: Request, { params }: { params: { proposalId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await recalculateAutomationProposal(userId, params.proposalId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Recalculation failed." }, { status: 409 }); }
}
