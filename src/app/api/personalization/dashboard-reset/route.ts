import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { previewPersonalizationReset, resetPersonalizationScope, resetScopeSchema } from "@/lib/personalization/dashboard";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})); const parsed = resetScopeSchema.safeParse(body.scope);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reset scope" }, { status: 400 });
  try {
    if (body.preview === true) return NextResponse.json(await previewPersonalizationReset(userId, parsed.data));
    const validConfirmation = parsed.data === "all" ? body.confirm === "RESET PERSONALIZATION" : body.confirm === true;
    if (!validConfirmation) return NextResponse.json({ error: parsed.data === "all" ? "Type RESET PERSONALIZATION to continue." : "Explicit confirmation is required." }, { status: 400 });
    return NextResponse.json(await resetPersonalizationScope(userId, parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Personalization reset failed" }, { status: 500 });
  }
}
