import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { automationSummary, getRecentlyAddedSettings, saveRecentlyAddedSettings } from "@/lib/recentlyAdded";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getRecentlyAddedSettings(userId);
  return NextResponse.json({ settings, summary: automationSummary(settings as any) });
}

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const settings = await saveRecentlyAddedSettings(userId, await request.json());
    return NextResponse.json({ settings, summary: automationSummary(settings as any) });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid settings", issues: error.issues }, { status: 400 });
    throw error;
  }
}

