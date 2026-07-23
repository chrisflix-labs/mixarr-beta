import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAiCapabilities } from "@/ai/governance/permissions";

export const dynamic = "force-dynamic";
export async function GET() {
  const capabilities = await getAiCapabilities(cookies().get("mixarr_session")?.value);
  if (!capabilities.authenticated) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 });
  return NextResponse.json(capabilities);
}

