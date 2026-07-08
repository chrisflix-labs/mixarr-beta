import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getWorkerHealthSummary } from "@/lib/workerHealth";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return unauthorized();

  try {
    return NextResponse.json(await getWorkerHealthSummary(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Worker] Failed to load worker health", error);
    return NextResponse.json({ error: "Failed to load worker health" }, { status: 500 });
  }
}
