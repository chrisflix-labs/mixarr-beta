import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupportSummary } from "@/lib/support";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await getSupportSummary(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Support] Failed to load summary", error);
    return NextResponse.json({ error: "Unable to generate diagnostics. Check logs or try again." }, { status: 500 });
  }
}
