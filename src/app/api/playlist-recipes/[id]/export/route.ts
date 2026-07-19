import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRecipeExport } from "@/lib/mixRecipes/transferService";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const query = new URL(req.url).searchParams;
    const result = await createRecipeExport({ userId, recipeIds: [params.id], archive: query.get("archive") === "1", includeArtwork: query.get("artwork") === "1" });
    return new NextResponse(typeof result.output === "string" ? result.output : Buffer.from(result.output), { headers: { "Content-Type": result.binary ? "application/zip" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store", "X-Mixarr-Export-Summary": encodeURIComponent(JSON.stringify({ recipeCount: result.recipeCount, formatVersion: result.formatVersion, artworkCount: result.artworkCount, warnings: result.warnings.length })) } });
  } catch (error) {
    const caught = error as Error & { code?: string; status?: number };
    return NextResponse.json({ error: caught.message, code: caught.code || "EXPORT_FAILED" }, { status: caught.status || 400 });
  }
}
