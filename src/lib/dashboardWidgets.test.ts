import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_SECTIONS,
  DASHBOARD_WIDGETS,
  assertUniqueDashboardWidgetIds,
  dashboardWidgetsForSection,
  resolveDashboardWidgets,
  type DashboardWidgetDefinition,
} from "./dashboardWidgets";

describe("dashboard widget registry", () => {
  it("registers Recently Added Discovery exactly once", () => {
    assert.equal(DASHBOARD_WIDGETS.filter((widget) => widget.id === "recently-added-discovery").length, 1);
    assert.equal(DASHBOARD_WIDGETS.filter((widget) => widget.title === "Recently Added Discovery").length, 1);
    const card = readFileSync(join(process.cwd(), "src", "components", "RecentlyAddedDiscoveryCard.tsx"), "utf8");
    assert.equal((card.match(/<h3>Recently Added Discovery<\/h3>/g) || []).length, 1);
  });

  it("detects duplicate widget IDs", () => {
    const duplicate = [DASHBOARD_WIDGETS[0], { ...DASHBOARD_WIDGETS[0] }] as DashboardWidgetDefinition[];
    assert.throws(() => assertUniqueDashboardWidgetIds(duplicate), /Duplicate dashboard widget IDs: library-readiness/);
  });

  it("filters feature flags instead of appending duplicate registrations", () => {
    const baseline = resolveDashboardWidgets();
    const flagged = resolveDashboardWidgets({ featureFlags: { "recently-added-discovery": true } });
    assert.equal(flagged.length, baseline.length);
    assert.equal(flagged.filter((widget) => widget.id === "recently-added-discovery").length, 1);
  });

  it("renders sections in the intended order with stable IDs", () => {
    const widgets = resolveDashboardWidgets();
    const encountered = Array.from(new Set(widgets.map((widget) => widget.section)));
    assert.deepEqual(encountered, DASHBOARD_SECTIONS);
    assert.ok(widgets.every((widget) => widget.id && widget.requiredPermission === "authenticated"));
  });

  it("keeps product information in one low-priority collapsed widget", () => {
    const products = dashboardWidgetsForSection("product-preview");
    assert.deepEqual(products.map((widget) => widget.id), ["product-preview"]);
    assert.equal(products[0]?.priority, "low");
    const page = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    assert.match(page, /<details className=\{styles\.productPanel\}>/);
    assert.doesNotMatch(page, /<details[^>]+open/);
  });

  it("renders the correct enabled and disabled Recently Added states", () => {
    const card = readFileSync(join(process.cwd(), "src", "components", "RecentlyAddedDiscoveryCard.tsx"), "utf8");
    assert.match(card, /Mixarr can still scan new music without applying automatic changes/);
    assert.match(card, /Enable Automation/);
    assert.match(card, /Review New Music/);
    assert.equal((card.match(/counts\.newTracks/g) || []).length, 1);
    assert.equal((card.match(/counts\.strongMatches/g) || []).length, 1);
    assert.equal((card.match(/counts\.suggestions/g) || []).length, 1);
    assert.equal((card.match(/counts\.waiting/g) || []).length, 1);
  });

  it("isolates dashboard failures and keeps empty states available", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    const plex = readFileSync(join(process.cwd(), "src", "components", "LibrarySelector.tsx"), "utf8");
    assert.match(page, /getDashboardSummary\(user\.id\)\.catch/);
    assert.match(page, /getRecentJobSummary\(user\.id\)\.catch/);
    assert.match(page, /getAutomationOverview\(user\.id\)\.catch/);
    assert.match(page, /getRecentlyAddedSummary\(user\.id\)\.catch/);
    assert.match(page, /No jobs recorded yet/);
    assert.match(page, /No playlists generated yet/);
    assert.match(plex, /No Plex server configured/);
    assert.match(page, /process\.env\.NODE_ENV === "development"/);
  });

  it("preserves primary routes and live updates without page reloads", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    const readiness = readFileSync(join(process.cwd(), "src", "components", "DashboardSummaryCards.tsx"), "utf8");
    const recentlyAdded = readFileSync(join(process.cwd(), "src", "components", "RecentlyAddedDiscoveryCard.tsx"), "utf8");
    for (const route of ["/builder", "/smart-builder", "/recently-added", "/recipes", "/generated-playlists", "/job-history", "/automation", "/playlist-history", "/release-notes", "/roadmap", "/support"]) {
      assert.ok((page + recentlyAdded).includes(`href=\"${route}`), `missing dashboard route ${route}`);
    }
    assert.match(readiness, /if \(!summary \|\| !hasLiveWork\(summary\)\) return/);
    assert.doesNotMatch(page + readiness, /window\.location\.reload|location\.reload/);
  });

  it("keeps responsive layouts overflow-safe at representative widths", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "page.module.css"), "utf8");
    for (const width of [390, 768, 1440, 1920]) {
      const columns = width <= 640 ? 1 : width <= 1024 ? 2 : 4;
      assert.ok(columns >= 1 && columns <= 4);
    }
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(css, /grid-template-columns: 1fr/);
    assert.match(css, /minmax\(0, 1fr\)/);
    assert.match(css, /overflow-wrap: anywhere/);
  });
});
