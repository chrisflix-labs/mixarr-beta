import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { restoreBuiltInRecipe } from "@/lib/builtInRecipes/service";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ recipe: await restoreBuiltInRecipe(userId, params.id) }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || "Recipe restore failed." }, { status: error?.status || 500 }); }
}
