import { NextResponse } from "next/server";
import { RECIPE_PRESET_TYPES } from "@/lib/recipeInheritance/service";
import { RECIPE_LAYER_PRIORITY, RECIPE_RESOLVER_VERSION } from "@/lib/recipeInheritance/resolver";
import { inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";

export async function GET() {
  if (!inheritanceSession()) return inheritanceUnauthorized();
  return NextResponse.json({ presetTypes: RECIPE_PRESET_TYPES, layerPriority: RECIPE_LAYER_PRIORITY, resolverVersion: RECIPE_RESOLVER_VERSION });
}
