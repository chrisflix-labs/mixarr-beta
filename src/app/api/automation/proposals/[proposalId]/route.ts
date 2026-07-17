import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { dismissAutomationProposal, getAutomationProposal } from "@/lib/automation";

export async function GET(_request: Request, { params }: { params: { proposalId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const proposal = await getAutomationProposal(userId, params.proposalId);
  return proposal ? NextResponse.json({ proposal }) : NextResponse.json({ error: "Proposal not found." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: { proposalId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const proposal = await dismissAutomationProposal(userId, params.proposalId);
    return proposal ? NextResponse.json({ proposal }) : NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Dismissal failed." }, { status: 409 }); }
}
