import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGenerationInsights } from "@/lib/smartMixExplanations/service";

export async function GET(_: Request, { params }: { params: { generationId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const generation = await getGenerationInsights(userId, params.generationId);
  if (!generation) return NextResponse.json({ error: "Generation insights are unavailable. This may be a v1 or historical playlist." }, { status: 404 });
  return NextResponse.json({ generation });
}
