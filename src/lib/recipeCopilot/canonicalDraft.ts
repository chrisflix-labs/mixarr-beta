import { playlistRecipeSchema } from "../playlistRecipes";
import { defaultRecipeStudioDraft } from "../recipeStudio";

const canonicalSections = [
  "filters", "scoring", "targets", "bpmFlow", "discovery", "variety",
  "playlistIdentity", "refreshPolicy", "automationPolicy",
] as const;

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

/**
 * Parses the authoritative Recipe Studio state first, then hydrates schema
 * defaults from the same draft shape used by the studio. Parsing before
 * hydration prevents a missing required name from being manufactured.
 */
export function canonicalRecipeDraftSnapshot(value: unknown): Record<string, unknown> {
  const parsed = playlistRecipeSchema.parse(value) as Record<string, unknown>;
  const defaults = defaultRecipeStudioDraft() as Record<string, unknown>;
  const hydrated: Record<string, unknown> = { ...defaults, ...clone(parsed) };
  for (const section of canonicalSections) {
    const defaultSection = defaults[section];
    const parsedSection = parsed[section];
    if (defaultSection && typeof defaultSection === "object" && !Array.isArray(defaultSection)) {
      hydrated[section] = {
        ...(defaultSection as Record<string, unknown>),
        ...(parsedSection && typeof parsedSection === "object" && !Array.isArray(parsedSection)
          ? parsedSection as Record<string, unknown>
          : {}),
      };
    }
  }
  return playlistRecipeSchema.parse(hydrated) as Record<string, unknown>;
}
