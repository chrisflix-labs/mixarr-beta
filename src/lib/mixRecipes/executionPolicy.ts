import type { RecipePermission } from "./governanceTypes";

export function assertRecipeExecutionAllowed(recipe: { id?: string; enabled: boolean; approvalState?: string | null; quarantineState?: string | null; trustState?: string | null; grantedPermissionsJson?: unknown }, action: RecipePermission, target?: { protected?: boolean; name?: string }) {
  if (!recipe.enabled) throw Object.assign(new Error("This recipe is disabled."), { code: "RECIPE_DISABLED", status: 409 });
  if (recipe.quarantineState && recipe.quarantineState !== "NONE") throw Object.assign(new Error("This recipe is quarantined and cannot execute."), { code: "RECIPE_QUARANTINED", status: 409 });
  if (!recipe.approvalState || !["APPROVED", "APPROVED_WITH_RESTRICTIONS"].includes(recipe.approvalState)) throw Object.assign(new Error("Local recipe approval is required before execution."), { code: "RECIPE_APPROVAL_REQUIRED", status: 409 });
  if (action === "playlist.delete") throw Object.assign(new Error("Recipes are never allowed to delete playlists."), { code: "RECIPE_PLAYLIST_DELETE_FORBIDDEN", status: 403 });
  if (target?.protected || action === "playlist.protected_update") throw Object.assign(new Error(`Protected playlist${target?.name ? ` “${target.name}”` : ""} cannot be changed by a recipe.`), { code: "RECIPE_PROTECTED_PLAYLIST", status: 403 });
  const granted = Array.isArray(recipe.grantedPermissionsJson) ? recipe.grantedPermissionsJson.map(String) : [];
  if (!granted.length && recipe.trustState === "LOCAL" && ["library.read", "playlist.create", "playlist.update", "automation.add_tracks"].includes(action)) return;
  if (!granted.includes(action)) throw Object.assign(new Error(`Recipe permission ${action} was not granted.`), { code: "RECIPE_PERMISSION_REQUIRED", status: 403 });
}
