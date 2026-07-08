import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getBugReportTemplate, getFeedbackTemplate } from "@/lib/support";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const params = new URL(request.url).searchParams;
    const type = params.get("type") || "bug";
    const context = {
      route: params.get("route"),
      libraryId: params.get("libraryId"),
    };
    const template = type === "feedback"
      ? await getFeedbackTemplate(userId, context)
      : await getBugReportTemplate(userId, context);
    return new NextResponse(template, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Support] Failed to generate template", error);
    return NextResponse.json({ error: "Unable to generate diagnostics. Check logs or try again." }, { status: 500 });
  }
}
