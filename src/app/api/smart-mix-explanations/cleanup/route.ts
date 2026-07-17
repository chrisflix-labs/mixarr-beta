import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cleanupExpiredExplanationTraces } from "@/lib/smartMixExplanations/service";

export async function POST() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await cleanupExpiredExplanationTraces(userId));
}
