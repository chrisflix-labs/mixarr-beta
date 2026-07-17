import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { updatePersonalizationOnboarding } from "@/lib/personalization/dashboard";

const schema = z.object({ state: z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"]), step: z.coerce.number().int().min(1).max(6), config: z.record(z.unknown()).optional() });
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid onboarding state" }, { status: 400 });
  try { return NextResponse.json(await updatePersonalizationOnboarding(userId, parsed.data)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Onboarding update failed" }, { status: 500 }); }
}
