import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cancelStagedImport, getStagedImport } from "@/lib/mixRecipes/transferService";

function responseError(error: unknown) {
  const caught = error as Error & { code?: string; status?: number };
  return NextResponse.json({ error: caught.message, code: caught.code || "IMPORT_STAGE_FAILED" }, { status: caught.status || 400 });
}

export async function GET(_req: Request, { params }: { params: { stageId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await getStagedImport(userId, params.stageId)); } catch (error) { return responseError(error); }
}

export async function DELETE(_req: Request, { params }: { params: { stageId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await cancelStagedImport(userId, params.stageId)); } catch (error) { return responseError(error); }
}
