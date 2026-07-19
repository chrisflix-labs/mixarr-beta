import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteSavedMappingRule, setSavedMappingRuleEnabled } from "@/lib/adaptiveRecipeMappingService";

function responseError(error: unknown) {
  const caught = error as Error & { code?: string; status?: number };
  return NextResponse.json({ error: caught.message, code: caught.code || "MAPPING_RULE_FAILED" }, { status: caught.status || 400 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const body = await req.json(); return NextResponse.json(await setSavedMappingRuleEnabled(userId, params.id, body.enabled === true)); }
  catch (error) { return responseError(error); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await deleteSavedMappingRule(userId, params.id)); }
  catch (error) { return responseError(error); }
}
