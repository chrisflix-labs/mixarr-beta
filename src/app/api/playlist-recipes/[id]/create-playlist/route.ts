import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createPlaylistFromRecipe } from "@/lib/mixRecipes/service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const result = await createPlaylistFromRecipe({ userId, recipeId: params.id, playlistName: body.playlistName, overrides: body.overrides, confirmAutomation: body.confirmAutomation === true });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create playlist from recipe.";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 });
  }
}

