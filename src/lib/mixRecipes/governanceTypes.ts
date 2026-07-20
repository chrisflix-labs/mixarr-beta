export const RECIPE_PERMISSIONS = [
  "playlist.create", "playlist.update", "playlist.delete", "playlist.protected_update",
  "automation.create", "automation.update", "automation.enable", "automation.fully_automatic",
  "automation.remove_tracks", "automation.add_tracks", "schedule.create", "schedule.frequent_refresh",
  "approval.disable", "library.read", "plex.collection.read", "plex.collection.write", "webhook.create",
  "notification.create", "external_integration.use",
] as const;

export type RecipePermission = typeof RECIPE_PERMISSIONS[number];
