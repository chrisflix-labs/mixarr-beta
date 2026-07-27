import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { recipeFingerprint } from "./recipeCopilot/core";
import { canonicalRecipeDraftSnapshot } from "./recipeCopilot/canonicalDraft";
import {
  applyRecipeProposalChanges,
  canonicalRecipeValueEqual,
  findRecipeProposalConflictDetails,
  findRecipeProposalConflicts,
  isRecipeProposalPathAllowed,
  normalizeLegacyProposalValue,
  stableRecipeProposalChangeId,
  type RecipeProposalChange,
} from "./recipeCopilot/proposalApply";
import { defaultRecipeStudioDraft } from "./recipeStudio";

const proposalId = "proposal-2419";
const change = (path: string, proposedValue: unknown, selected = true): RecipeProposalChange => ({
  id: stableRecipeProposalChangeId(proposalId, path),
  path,
  proposedValue,
  selected,
});

function success(result: ReturnType<typeof applyRecipeProposalChanges>) {
  if (!result.success) throw new Error(result.failures[0]?.message);
  assert.equal(result.success, true);
  return result;
}

describe("v2.4.19 canonical Recipe Copilot equality", () => {
  it("1. equal base and current strings do not conflict", () => {
    const base = defaultRecipeStudioDraft();
    const current = structuredClone(base);
    assert.deepEqual(findRecipeProposalConflicts(base, current, [change("name", "All-Genre Popular Hits")]), []);
  });

  it("2. current differing from both base and proposed is a genuine conflict", () => {
    const base = defaultRecipeStudioDraft();
    const current = { ...structuredClone(base), name: "My Manual Playlist Name" };
    assert.deepEqual(findRecipeProposalConflicts(base, current, [change("name", "All-Genre Popular Hits")]), ["name"]);
  });

  it("3. current equal to proposed is idempotent, not conflicting", () => {
    const base = defaultRecipeStudioDraft();
    const current = { ...structuredClone(base), name: "All-Genre Popular Hits" };
    assert.deepEqual(findRecipeProposalConflicts(base, current, [change("name", "All-Genre Popular Hits")]), []);
    const result = success(applyRecipeProposalChanges(current, [change("name", "All-Genre Popular Hits")]));
    assert.equal(result.appliedCount, 0);
    assert.equal(result.alreadyAppliedCount, 1);
    assert.deepEqual(result.alreadyAppliedPaths, ["name"]);
  });

  it("4. decodes one JSON-string layer for a string destination", () => {
    assert.equal(normalizeLegacyProposalValue("name", "\"All-Genre Popular Hits\""), "All-Genre Popular Hits");
    assert.equal(normalizeLegacyProposalValue("name", "\"\\\"Nested\\\"\""), "\"Nested\"");
  });

  it("5. does not unnecessarily parse plain strings or non-string destinations", () => {
    assert.equal(normalizeLegacyProposalValue("name", "All-Genre Popular Hits"), "All-Genre Popular Hits");
    assert.equal(normalizeLegacyProposalValue("filters.limit", "\"100\""), "\"100\"");
    assert.equal(normalizeLegacyProposalValue("name", "{\"value\":\"name\"}"), "{\"value\":\"name\"}");
  });

  it("6. ignores object property insertion order", () => {
    assert.equal(canonicalRecipeValueEqual("filters.rules", [{ field: "genre", operator: "eq", value: "Rock", type: "rule" }], [{ value: "Rock", type: "rule", operator: "eq", field: "genre" }]), true);
  });

  it("7. preserves ordered recipe rule-array meaning", () => {
    const first = { field: "genre", operator: "eq", value: "Rock" };
    const second = { field: "popularity", operator: "gte", value: "80" };
    assert.equal(canonicalRecipeValueEqual("filters.rules", [first, second], [second, first]), false);
  });

  it("8. compares schema-defined tag arrays as unordered sets", () => {
    assert.equal(canonicalRecipeValueEqual("playlistIdentity.preferredGenres", ["Rock", "Pop"], ["Pop", "Rock"]), true);
  });

  it("9. treats missing optional arrays and schema-default empty arrays equally", () => {
    assert.equal(canonicalRecipeValueEqual("playlistIdentity.avoidedGenres", undefined, []), true);
    const sparse = canonicalRecipeDraftSnapshot({ name: "Sparse", filters: {} });
    assert.deepEqual((sparse.playlistIdentity as any).avoidedGenres, []);
    assert.deepEqual((sparse.filters as any).rules, []);
  });

  it("10. keeps false distinct from missing unless the schema path has a default", () => {
    assert.equal(canonicalRecipeValueEqual("custom.optionalBoolean", false, undefined), false);
    assert.equal(canonicalRecipeValueEqual("filters.negativeFilters.excludeHoliday", false, undefined), true);
    assert.equal(canonicalRecipeValueEqual("filters.preferNonLive", false, undefined), false);
  });

  it("11. normalizes null according to canonical schema defaults", () => {
    assert.equal(canonicalRecipeValueEqual("description", null, ""), true);
    assert.equal(canonicalRecipeValueEqual("targets.primaryMood", null, undefined), true);
  });

  it("uses stable canonical draft hashes and excludes volatile UI timestamps", () => {
    const left = { name: "Name", filters: { rules: [], limit: 100 }, updatedAt: "one", localUiState: { open: true } };
    const right = { filters: { limit: 100, rules: [] }, name: "Name", updatedAt: "two", localUiState: { open: false } };
    assert.equal(recipeFingerprint(left), recipeFingerprint(right));
  });
});

describe("v2.4.19 reported name regression and application model", () => {
  it("18. applies the unchanged-name fixture without a conflict and marks a real change", () => {
    const base = canonicalRecipeDraftSnapshot({ name: "Untitled Mix Recipe", filters: { rules: [] } });
    const current = canonicalRecipeDraftSnapshot({ name: "Untitled Mix Recipe", filters: { rules: [] } });
    const selected = [change("name", "All-Genre Popular Hits")];
    assert.deepEqual(findRecipeProposalConflictDetails(base, current, selected), []);
    const result = success(applyRecipeProposalChanges(current, selected));
    assert.equal(result.draft.name, "All-Genre Popular Hits");
    assert.equal(result.appliedCount, 1);
    assert.notEqual(JSON.stringify(result.draft), JSON.stringify(current));
  });

  it("19. reports a manual name edit as the only genuine conflict", () => {
    const base = canonicalRecipeDraftSnapshot({ name: "Untitled Mix Recipe", filters: { rules: [] } });
    const current = { ...base, name: "My Manual Playlist Name", description: "Unrelated edit" };
    const conflicts = findRecipeProposalConflictDetails(base, current, [
      change("name", "All-Genre Popular Hits"),
      change("filters.limit", 80),
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].path, "name");
    assert.equal(conflicts[0].label, "Name");
  });

  it("20. never writes legacy JSON quotation marks into the name", () => {
    const source = defaultRecipeStudioDraft();
    const result = success(applyRecipeProposalChanges(source, [change("name", "\"All-Genre Popular Hits\"")]));
    assert.equal(result.draft.name, "All-Genre Popular Hits");
  });

  it("22-24. preserves keep-current conflicts while applying independent proposed fields", () => {
    const current = { ...defaultRecipeStudioDraft(), name: "My Manual Playlist Name" };
    const result = success(applyRecipeProposalChanges(current, [change("filters.limit", 80)]));
    assert.equal(result.draft.name, "My Manual Playlist Name");
    assert.equal((result.draft.filters as any).limit, 80);
  });

  it("28. repeated application is idempotent with useful counts", () => {
    const source = defaultRecipeStudioDraft();
    const selected = [change("name", "All-Genre Popular Hits"), change("filters.limit", 80)];
    const first = success(applyRecipeProposalChanges(source, selected));
    const second = success(applyRecipeProposalChanges(first.draft, selected));
    assert.deepEqual({ appliedCount: first.appliedCount, alreadyAppliedCount: first.alreadyAppliedCount }, { appliedCount: 2, alreadyAppliedCount: 0 });
    assert.deepEqual({ appliedCount: second.appliedCount, alreadyAppliedCount: second.alreadyAppliedCount }, { appliedCount: 0, alreadyAppliedCount: 2 });
  });

  it("14-15. keeps protected and prototype-pollution paths out of proposals", () => {
    for (const path of ["id", "enabled", "filters.libraryId", "__proto__.polluted", "constructor.prototype.polluted"]) {
      assert.equal(isRecipeProposalPathAllowed(path), false, path);
    }
    assert.equal(({} as any).polluted, undefined);
  });
});

describe("v2.4.19 Recipe Studio and conflict workflow contracts", () => {
  const studio = readFileSync("src/components/RecipeStudio.tsx", "utf8");
  const drawer = readFileSync("src/components/RecipeCopilot.tsx", "utf8");
  const service = readFileSync("src/lib/recipeCopilot/service.ts", "utf8");
  const applyService = service.slice(service.indexOf("export async function applyRecipeCopilotProposal"), service.indexOf("export async function validateRecipeCopilotProposal"));

  it("12 and 17. captures the base from the active Recipe Studio accessor, not AI output", () => {
    assert.match(studio, /getDraftSnapshot/);
    assert.match(drawer, /const baseDraft = getDraftSnapshot\(\)/);
    assert.match(drawer, /recipe: baseDraft, baseDraft/);
    assert.match(service, /canonicalRecipeDraftSnapshot\(input\.baseDraft \|\| input\.recipe/);
    assert.match(drawer, /proposal\?\.baseDraft/);
  });

  it("13. determines conflicts per selected path instead of whole-draft revision staleness", () => {
    assert.match(applyService, /findRecipeProposalConflictDetails/);
    assert.doesNotMatch(applyService, /isStaleRecipeResult/);
    assert.doesNotMatch(applyService, /saved recipe changed after this proposal/);
  });

  it("16. disables generation until Recipe Studio initialization completes", () => {
    assert.match(studio, /const \[initialized, setInitialized\]/);
    assert.match(studio, /disabled=\{!initialized\}/);
    assert.match(drawer, /formReady && recipeCopilotCanRequest/);
  });

  it("21-24. renders safe field-level conflict resolution controls and actions", () => {
    for (const marker of [
      "Some recipe fields changed after this proposal was created",
      "When proposal was generated",
      "My current value",
      "Recipe Copilot proposal",
      "Keep my current value",
      "Use Copilot proposal",
      "Apply non-conflicting changes",
      "Use selected Copilot values",
      "Cancel and continue editing",
    ]) assert.match(drawer, new RegExp(marker));
  });

  it("25-27. updates the local draft, reruns validation, remains dirty, and never saves automatically", () => {
    assert.match(studio, /setDraft\(result\.draft\)/);
    assert.match(studio, /setAnalysisState\("stale"\)/);
    assert.match(studio, /Save draft/);
    assert.match(applyService, /persisted: false/);
    assert.doesNotMatch(applyService, /updatePlaylistRecipeData|playlistRecipe\.update/);
  });

  it("29. classifies conflicts separately from unexpected apply failures", () => {
    assert.match(applyService, /errorCode: "AI_RECIPE_PROPOSAL_CONFLICT"/);
    assert.match(applyService, /AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_MISSING/);
    assert.match(applyService, /AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_INVALID/);
    assert.match(applyService, /failure\("AI_RECIPE_PROPOSAL_APPLY_FAILED"[\s\S]*unexpected error/i);
  });

  it("30. retains the generic apply code only for unexpected exceptions", () => {
    assert.match(applyService, /original\?\.code[\s\S]*AI_RECIPE_PROPOSAL_APPLY_FAILED/);
    assert.doesNotMatch(applyService, /throw failure\("AI_RECIPE_PROPOSAL_APPLY_FAILED", `The recipe changed/);
  });

  it("retains the v2.4.19 release history after later version bumps", () => {
    assert.equal(JSON.parse(readFileSync("package.json", "utf8")).version, "2.4.22");
    assert.match(readFileSync("Dockerfile", "utf8"), /NEXT_PUBLIC_APP_VERSION=2\.4\.22/);
    assert.match(readFileSync("Dockerfile", "utf8"), /org\.opencontainers\.image\.version="2\.4\.22"/);
    assert.match(readFileSync("CHANGELOG.md", "utf8"), /v2\.4\.19 - Canonical Recipe Copilot Conflict Detection/);
    assert.match(readFileSync("README.md", "utf8"), /Current release: \*\*v2\.4\.22/);
    assert.match(readFileSync("docs/RECIPE_COPILOT_CONFLICTS_V2419.md", "utf8"), /three-way equality/i);
  });
});
