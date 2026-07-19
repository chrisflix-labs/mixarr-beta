import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { recipeImportDiagnostic } from "@/lib/mixRecipes/transferService";

export async function GET(_req: Request, { params }: { params: { historyId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const diagnostic = await recipeImportDiagnostic(userId, params.historyId);
    const filename = `mixarr-import-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(diagnostic, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    const caught = error as Error & { code?: string; status?: number };
    return NextResponse.json({ error: caught.message, code: caught.code || "DIAGNOSTIC_FAILED" }, { status: caught.status || 400 });
  }
}
