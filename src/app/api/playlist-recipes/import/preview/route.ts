import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { stageRecipeImport } from "@/lib/mixRecipes/transferService";

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const content = typeof body.content === "string" ? body.content : JSON.stringify(body.content);
    const result = await stageRecipeImport({ userId, filename: typeof body.filename === "string" ? body.filename : "mixarr-recipe-import.json", content, encoding: body.encoding === "base64" ? "base64" : "utf8" });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const caught = error as Error & { code?: string; status?: number };
    return NextResponse.json({ error: caught.message, code: caught.code || "IMPORT_PREVIEW_FAILED" }, { status: caught.status || 400 });
  }
}
