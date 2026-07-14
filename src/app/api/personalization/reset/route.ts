import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPersonalizationProfileSummary, resetPersonalizationData } from "@/lib/personalization";

const schema = z.object({
  confirm: z.literal("RESET PERSONALIZATION"),
  mode: z.enum(["learned", "all"]).default("learned"),
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Type RESET PERSONALIZATION to confirm this destructive action." }, { status: 400 });
  try {
    const result = await resetPersonalizationData(userId, parsed.data.mode);
    return NextResponse.json({ result, summary: await getPersonalizationProfileSummary(userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Personalization reset failed" }, { status: 500 });
  }
}

