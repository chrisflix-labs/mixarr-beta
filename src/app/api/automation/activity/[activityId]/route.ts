import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAutomationActivity } from "@/lib/automation";

export async function GET(_request: Request, { params }: { params: { activityId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const activity = await getAutomationActivity(userId, params.activityId);
  return activity ? NextResponse.json({ activity }) : NextResponse.json({ error: "Activity not found." }, { status: 404 });
}
