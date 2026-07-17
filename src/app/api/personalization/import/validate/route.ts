import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validatePersonalizationImport, type PersonalizationImportMode } from "@/lib/personalization/dashboard";

const modes = new Set(["merge", "replace", "identities", "preferences", "feedback"]);
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json(); const mode = modes.has(body.mode) ? body.mode as PersonalizationImportMode : "merge";
    const { preview } = await validatePersonalizationImport(userId, body.content, mode);
    return NextResponse.json({ preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import validation failed";
    return NextResponse.json({ error: message }, { status: /too large/i.test(message) ? 413 : 400 });
  }
}
