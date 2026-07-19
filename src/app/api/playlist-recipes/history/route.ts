import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearRecipeTransferHistory, recipeTransferHistory } from "@/lib/mixRecipes/transferService";

function responseError(error: unknown) {
  const caught = error as Error & { code?: string; status?: number };
  return NextResponse.json({ error: caught.message, code: caught.code || "HISTORY_FAILED" }, { status: caught.status || 400 });
}

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await recipeTransferHistory(userId)); } catch (error) { return responseError(error); }
}

export async function DELETE() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await clearRecipeTransferHistory(userId)); } catch (error) { return responseError(error); }
}
