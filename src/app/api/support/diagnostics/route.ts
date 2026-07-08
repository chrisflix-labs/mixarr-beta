import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupportDiagnostics } from "@/lib/support";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await getSupportDiagnostics(userId);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mixarr-support-diagnostics-${Date.now()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Support] Failed to export diagnostics", error);
    return NextResponse.json({ error: "Unable to generate diagnostics. Check logs or try again." }, { status: 500 });
  }
}
