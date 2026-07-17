import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAutomationOverview, saveAutomationPolicy } from "@/lib/automation";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getAutomationOverview(userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await saveAutomationPolicy(userId, await request.json());
    return NextResponse.json(await getAutomationOverview(userId));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid automation policy.", issues: error.issues }, { status: 400 });
    throw error;
  }
}
