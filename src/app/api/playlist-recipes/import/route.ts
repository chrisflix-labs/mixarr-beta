import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { confirmRecipeImport } from "@/lib/mixRecipes/transferService";

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (typeof body.stageId !== "string") return NextResponse.json({ error: "Preview and stage the import before confirming it.", code: "IMPORT_STAGE_REQUIRED" }, { status: 400 });
    if (typeof body.previewId !== "string" || !body.previewId) return NextResponse.json({ error: "Review the current import preview before confirming it.", code: "IMPORT_PREVIEW_ID_REQUIRED" }, { status: 400 });
    const result = await confirmRecipeImport({ userId, stageId: body.stageId, previewId: body.previewId, mode: body.mode, decisions: Array.isArray(body.decisions) ? body.decisions : [] });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const caught = error as Error & { code?: string; status?: number; changedDomains?: string[] };
    return NextResponse.json({ error: caught.message, code: caught.code || "IMPORT_FAILED", ...(caught.changedDomains ? { changedDomains: caught.changedDomains } : {}) }, { status: caught.status || 400 });
  }
}
