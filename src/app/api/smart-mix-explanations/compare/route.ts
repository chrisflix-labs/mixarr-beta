import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { compareCandidates } from "@/lib/smartMixExplanations/service";

const schema = z.object({ generationId: z.string().min(1), trackIds: z.array(z.string().min(1)).length(2).refine((ids) => ids[0] !== ids[1], "Choose two different candidates") });

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid comparison" }, { status: 400 });
  const comparison = await compareCandidates(userId, parsed.data.generationId, parsed.data.trackIds);
  if (!comparison) return NextResponse.json({ error: "Both candidate traces must be retained in the same generation." }, { status: 404 });
  return NextResponse.json({ comparison });
}
