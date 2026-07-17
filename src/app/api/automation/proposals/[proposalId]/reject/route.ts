import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectAutomationProposal } from "@/lib/automation";

const schema = z.object({ itemIds: z.array(z.string().uuid()).max(500).optional(), reason: z.string().trim().max(500).nullable().optional() });
export async function POST(request: Request, { params }: { params: { proposalId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const proposal = await rejectAutomationProposal(userId, params.proposalId, parsed.data.reason, parsed.data.itemIds);
  return proposal ? NextResponse.json({ proposal }) : NextResponse.json({ error: "Proposal not found." }, { status: 404 });
}
