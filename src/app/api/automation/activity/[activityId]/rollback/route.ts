import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rollbackAutomationActivity } from "@/lib/automation";

const schema = z.object({ confirm: z.boolean().default(false), expectedPlaylistUpdatedAt: z.string().datetime().optional() });
export async function POST(request: Request, { params }: { params: { activityId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const result = await rollbackAutomationActivity(userId, params.activityId, parsed.data.confirm, parsed.data.expectedPlaylistUpdatedAt);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Activity not found." }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Rollback failed." }, { status: 409 }); }
}
