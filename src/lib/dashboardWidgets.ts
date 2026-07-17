export const DASHBOARD_SECTIONS = [
  "library-readiness",
  "quick-actions",
  "activity-automation",
  "playlist-management",
  "product-preview",
  "plex-servers",
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];
export type DashboardPriority = "high" | "medium" | "low";
export type DashboardPermission = "authenticated" | "admin";

export type DashboardWidgetDefinition = {
  id: string;
  title: string;
  section: DashboardSection;
  priority: DashboardPriority;
  enabled: boolean;
  featureFlag?: string;
  component: string;
  order: number;
  compact: boolean;
  requiredPermission: DashboardPermission;
};

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  { id: "library-readiness", title: "Library Readiness", section: "library-readiness", priority: "high", enabled: true, component: "LibraryReadiness", order: 10, compact: false, requiredPermission: "authenticated" },
  { id: "smart-playlist-builder", title: "Smart Playlist Builder", section: "quick-actions", priority: "high", enabled: true, component: "SmartBuilder", order: 10, compact: true, requiredPermission: "authenticated" },
  { id: "recently-added-discovery", title: "Recently Added Discovery", section: "quick-actions", priority: "medium", enabled: true, component: "RecentlyAddedDiscovery", order: 20, compact: true, requiredPermission: "authenticated" },
  { id: "playlist-recipes", title: "Playlist Recipes", section: "quick-actions", priority: "medium", enabled: true, component: "PlaylistRecipes", order: 30, compact: true, requiredPermission: "authenticated" },
  { id: "playlist-regeneration", title: "Playlist Regeneration", section: "quick-actions", priority: "medium", enabled: true, component: "PlaylistRegeneration", order: 40, compact: true, requiredPermission: "authenticated" },
  { id: "activity-automation", title: "Activity & Automation", section: "activity-automation", priority: "high", enabled: true, component: "ActivityAutomation", order: 10, compact: false, requiredPermission: "authenticated" },
  { id: "worker-health", title: "Background Worker", section: "activity-automation", priority: "high", enabled: true, component: "WorkerHealth", order: 20, compact: true, requiredPermission: "authenticated" },
  { id: "playlist-management", title: "Playlist Management", section: "playlist-management", priority: "medium", enabled: true, component: "PlaylistManagement", order: 10, compact: true, requiredPermission: "authenticated" },
  { id: "product-preview", title: "Product & Preview", section: "product-preview", priority: "low", enabled: true, component: "ProductPreview", order: 10, compact: true, requiredPermission: "authenticated" },
  { id: "plex-servers", title: "Plex Servers", section: "plex-servers", priority: "medium", enabled: true, component: "PlexServers", order: 10, compact: true, requiredPermission: "authenticated" },
] as const;

export function duplicateDashboardWidgetIds(widgets: readonly DashboardWidgetDefinition[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const widget of widgets) {
    if (seen.has(widget.id)) duplicates.add(widget.id);
    seen.add(widget.id);
  }
  return Array.from(duplicates);
}

export function assertUniqueDashboardWidgetIds(widgets: readonly DashboardWidgetDefinition[]) {
  const duplicates = duplicateDashboardWidgetIds(widgets);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate dashboard widget IDs: ${duplicates.join(", ")}`);
  }
}

export function resolveDashboardWidgets({
  featureFlags = {},
  permissions = ["authenticated"],
}: {
  featureFlags?: Record<string, boolean>;
  permissions?: readonly DashboardPermission[];
} = {}) {
  assertUniqueDashboardWidgetIds(DASHBOARD_WIDGETS);
  const allowed = new Set(permissions);
  return DASHBOARD_WIDGETS
    .filter((widget) => widget.enabled)
    .filter((widget) => !widget.featureFlag || featureFlags[widget.featureFlag] === true)
    .filter((widget) => allowed.has(widget.requiredPermission))
    .sort((left, right) => {
      const sectionOrder = DASHBOARD_SECTIONS.indexOf(left.section) - DASHBOARD_SECTIONS.indexOf(right.section);
      return sectionOrder || left.order - right.order;
    });
}

export function dashboardWidgetsForSection(
  section: DashboardSection,
  options?: Parameters<typeof resolveDashboardWidgets>[0],
) {
  return resolveDashboardWidgets(options).filter((widget) => widget.section === section);
}

if (process.env.NODE_ENV !== "production") {
  assertUniqueDashboardWidgetIds(DASHBOARD_WIDGETS);
}
