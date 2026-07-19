import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateRecipe } from "@/lib/mixRecipes/validation";

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const result = validateRecipe(body?.recipe ?? body);
  return NextResponse.json(result, { status: result.valid ? 200 : 400 });
}

