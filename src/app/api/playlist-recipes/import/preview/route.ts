import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  buildImportPreview,
  INVALID_RECIPE_EXPORT_MESSAGE,
  UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE,
} from "@/lib/playlistRecipeImportExport";

const maxImportBytes = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const content = typeof body.content === "string" ? body.content : JSON.stringify(body.content);
    if (Buffer.byteLength(content, "utf8") > maxImportBytes) {
      return NextResponse.json({ error: "Recipe import file is too large." }, { status: 413 });
    }

    const existingRecipes = await prisma.playlistRecipe.findMany({
      where: { userId, isArchived: false },
      select: { name: true },
    });
    const preview = buildImportPreview(content, existingRecipes.map((recipe) => recipe.name));

    return NextResponse.json({ preview });
  } catch (error: any) {
    const message = error.message === UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE
      ? UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE
      : INVALID_RECIPE_EXPORT_MESSAGE;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
