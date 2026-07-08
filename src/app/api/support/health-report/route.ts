import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getHealthSupportReport } from "@/lib/support";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const libraryId = new URL(request.url).searchParams.get("libraryId");
    const report = await getHealthSupportReport(userId, libraryId);
    return new NextResponse(report, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Support] Failed to generate health report", error);
    return NextResponse.json({ error: "Unable to generate diagnostics. Check logs or try again." }, { status: 500 });
  }
}
