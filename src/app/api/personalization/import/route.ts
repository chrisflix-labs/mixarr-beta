import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { importPersonalizationData, type PersonalizationImportMode } from "@/lib/personalization/dashboard";

const modes = new Set(["merge", "replace", "identities", "preferences", "feedback"]);
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!modes.has(body.mode) || body.confirm !== true) return NextResponse.json({ error: "A valid import mode and explicit confirmation are required." }, { status: 400 });
    return NextResponse.json(await importPersonalizationData(userId, body.content, body.mode as PersonalizationImportMode));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Personalization import failed";
    return NextResponse.json({ error: message }, { status: /valid|schema|JSON|large/i.test(message) ? 400 : 500 });
  }
}
