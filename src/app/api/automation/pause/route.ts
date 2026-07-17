import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { setAutomationPause } from "@/lib/automation";

const schema = z.object({ paused: z.boolean(), reason: z.string().trim().max(500).nullable().optional() });

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid pause request." }, { status: 400 });
  return NextResponse.json({ policy: await setAutomationPause(userId, parsed.data.paused, parsed.data.reason) });
}
