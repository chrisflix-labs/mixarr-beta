import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listSavedMappingRules, upsertSavedMappingRule } from "@/lib/adaptiveRecipeMappingService";

function responseError(error: unknown) {
  const caught = error as Error & { code?: string; status?: number };
  return NextResponse.json({ error: caught.message, code: caught.code || "MAPPING_RULE_FAILED" }, { status: caught.status || 400 });
}

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(req.url).searchParams;
  try { return NextResponse.json({ mappings: await listSavedMappingRules(userId, { libraryId: query.get("libraryId"), search: query.get("search") || undefined, mappingType: query.get("type") || undefined, includeDisabled: query.get("includeDisabled") === "1" }) }); }
  catch (error) { return responseError(error); }
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const mapping = await upsertSavedMappingRule(userId, { id: typeof body.id === "string" ? body.id : undefined, libraryId: typeof body.libraryId === "string" ? body.libraryId : null, mappingType: String(body.mappingType || ""), sourceValue: String(body.sourceValue || ""), destinationValues: Array.isArray(body.destinationValues) ? body.destinationValues.map(String) : [], enabled: body.enabled !== false });
    return NextResponse.json({ mapping }, { status: body.id ? 200 : 201 });
  } catch (error) { return responseError(error); }
}
