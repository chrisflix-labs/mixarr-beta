import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildPersonalizationExport } from "@/lib/personalization/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await buildPersonalizationExport(userId);
    if (new URL(request.url).searchParams.get("preview") === "1") return NextResponse.json(result.summary);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(result.payload, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="mixarr-personalization-${date}.json"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Personalization export failed" }, { status: 500 });
  }
}
