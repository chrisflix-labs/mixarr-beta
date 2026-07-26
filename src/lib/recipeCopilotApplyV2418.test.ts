import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { playlistRecipeSchema } from "./playlistRecipes";
import { defaultRecipeStudioDraft } from "./recipeStudio";
import {
  applyRecipeProposalChanges, findRecipeProposalConflicts, stableRecipeProposalChangeId,
  type RecipeProposalChange,
} from "./recipeCopilot/proposalApply";

const proposalId = "proposal-2418";
const change = (path: string, currentValue: unknown, proposedValue: unknown, selected = true): RecipeProposalChange => ({
  id: stableRecipeProposalChangeId(proposalId, path),
  path,
  currentValue,
  proposedValue,
  selected,
});

function expectSuccess(result: ReturnType<typeof applyRecipeProposalChanges>) {
  assert.ok(result.success);
  return result;
}

describe("v2.4.18 atomic Recipe Copilot proposal patching", () => {
  it("1. applies one selected scalar field", () => {
    const source = defaultRecipeStudioDraft();
    const result = expectSuccess(applyRecipeProposalChanges(source, [change("name", source.name, "Popular Hits")]));
    assert.equal(result.draft.name, "Popular Hits");
  });

  it("2. applies multiple selected fields", () => {
    const source = defaultRecipeStudioDraft();
    const result = expectSuccess(applyRecipeProposalChanges(source, [
      change("name", source.name, "Popular Hits"),
      change("filters.limit", 100, 60),
    ]));
    assert.equal(result.draft.name, "Popular Hits");
    assert.equal((result.draft.filters as any).limit, 60);
    assert.deepEqual(result.appliedPaths, ["name", "filters.limit"]);
  });

  it("3. ignores unselected fields", () => {
    const source = defaultRecipeStudioDraft();
    const result = expectSuccess(applyRecipeProposalChanges(source, [
      change("name", source.name, "Popular Hits"),
      change("filters.limit", 100, 60, false),
    ]));
    assert.equal((result.draft.filters as any).limit, 100);
  });

  it("4. replaces filters.rules immutably", () => {
    const source = defaultRecipeStudioDraft();
    const rules = [{ field: "popularity", operator: "gte", value: "80" }];
    const result = expectSuccess(applyRecipeProposalChanges(source, [change("filters.rules", [], rules)]));
    assert.deepEqual((result.draft.filters as any).rules, rules);
    assert.notEqual((result.draft.filters as any).rules, rules);
    assert.deepEqual(source.filters.rules, []);
  });

  it("5. applies nested boolean fields", () => {
    const source = defaultRecipeStudioDraft();
    source.filters.preferNonLive = false;
    const result = expectSuccess(applyRecipeProposalChanges(source, [change("filters.preferNonLive", false, true)]));
    assert.equal((result.draft.filters as any).preferNonLive, true);
  });

  it("6. never mutates the current draft", () => {
    const source = defaultRecipeStudioDraft();
    const snapshot = JSON.stringify(source);
    const result = expectSuccess(applyRecipeProposalChanges(source, [change("discovery.familiarityBalance", 50, 75)]));
    assert.notEqual(result.draft, source);
    assert.equal(JSON.stringify(source), snapshot);
    assert.notEqual(result.draft.discovery, source.discovery);
  });

  it("7-9. rejects unknown, protected, and prototype-pollution paths", () => {
    for (const [path, expectedCode] of [
      ["unknown.setting", "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED"],
      ["id", "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED"],
      ["filters.__proto__.polluted", "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED"],
      ["constructor.prototype.polluted", "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED"],
    ]) {
      const result = applyRecipeProposalChanges(defaultRecipeStudioDraft(), [change(path, null, true)]);
      assert.equal(result.success, false);
      if (result.success) continue;
      assert.equal(result.failures[0].path, path);
      assert.equal(result.failures[0].code, expectedCode);
    }
    assert.equal(({} as any).polluted, undefined);
  });

  it("10. returns path-specific failures", () => {
    const result = applyRecipeProposalChanges(defaultRecipeStudioDraft(), [change("ownerId", null, "other")]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.failures[0].path, "ownerId");
      assert.match(result.failures[0].message, /ownerId/);
    }
  });

  it("11. validates every change before applying any change", () => {
    const source = defaultRecipeStudioDraft();
    const result = applyRecipeProposalChanges(source, [
      change("name", source.name, "Must not be applied"),
      change("approvalState", "APPROVED", "BYPASSED"),
    ]);
    assert.equal(result.success, false);
    assert.equal(source.name, "Untitled Mix Recipe");
  });

  it("12. preserves unrelated draft fields", () => {
    const source: Record<string, any> = { ...defaultRecipeStudioDraft(), localUiState: { expanded: true } };
    const result = expectSuccess(applyRecipeProposalChanges(source, [change("name", source.name, "New name")]));
    assert.deepEqual(result.draft.localUiState, { expanded: true });
  });
});

describe("v2.4.18 Recipe Studio apply integration", () => {
  it("applies the reported boolean, popularity rule, and name and remains schema-valid", () => {
    const source = defaultRecipeStudioDraft();
    source.filters.preferNonLive = false;
    const rules = [{ field: "popularity", operator: "gte", value: "80" }];
    const result = expectSuccess(applyRecipeProposalChanges(source, [
      change("filters.preferNonLive", false, true),
      change("filters.rules", [], rules),
      change("name", "Untitled Mix Recipe", "All-Genre Popular Hits"),
    ]));
    assert.equal((result.draft.filters as any).preferNonLive, true);
    assert.deepEqual((result.draft.filters as any).rules, rules);
    assert.equal(result.draft.name, "All-Genre Popular Hits");
    assert.equal(playlistRecipeSchema.safeParse(result.draft).success, true);
    assert.notEqual(JSON.stringify(result.draft), JSON.stringify(source), "The custom Recipe Studio dirty comparison must become true.");
  });

  it("supports Advanced/custom, Focus, Party, and Chill recipe drafts", () => {
    for (const category of ["Custom", "Focus", "Party", "Chill"]) {
      const source = { ...defaultRecipeStudioDraft(), category };
      const result = expectSuccess(applyRecipeProposalChanges(source, [
        change("filters.negativeFilters.excludeLive", undefined, true),
      ]));
      assert.equal(playlistRecipeSchema.safeParse(result.draft).success, true, category);
    }
  });

  it("detects only selected fields changed manually after generation", () => {
    const base = defaultRecipeStudioDraft();
    const current = { ...base, name: "Manual name", description: "Unrelated manual edit" };
    assert.deepEqual(findRecipeProposalConflicts(base, current, [
      change("name", base.name, "Copilot name"),
      change("filters.limit", 100, 80),
    ]), ["name"]);
  });

  it("preserves unrelated manual edits while applying selected fields", () => {
    const current: Record<string, any> = { ...defaultRecipeStudioDraft(), description: "Manual description" };
    const result = expectSuccess(applyRecipeProposalChanges(current, [change("name", current.name, "Copilot name")]));
    assert.equal(result.draft.description, "Manual description");
  });
});

describe("v2.4.18 Recipe Copilot component and persistence contracts", () => {
  const drawer = readFileSync("src/components/RecipeCopilot.tsx", "utf8");
  const studio = readFileSync("src/components/RecipeStudio.tsx", "utf8");
  const service = readFileSync("src/lib/recipeCopilot/service.ts", "utf8");
  const applyService = service.slice(service.indexOf("export async function applyRecipeCopilotProposal"), service.indexOf("export async function validateRecipeCopilotProposal"));

  it("13-18. has explicit disabled, button, loading, single-callback, and double-click guards", () => {
    assert.match(drawer, /type="button" className=\{styles\.generate\}/);
    assert.match(drawer, /selectedChanges\.length === 0 \|\| applying \|\| proposalUnavailable/);
    assert.match(drawer, /Applying…/);
    assert.match(drawer, /applyingRef\.current/);
    assert.match(drawer, /await onApplyChanges\(/);
    assert.equal((drawer.match(/await onApplyChanges\(/g) || []).length, 1);
  });

  it("19-25. closes only on success and preserves selection with actionable failure feedback", () => {
    const successIndex = drawer.indexOf("onClose();", drawer.indexOf("async function applySelected"));
    const catchIndex = drawer.indexOf("} catch (caught)", drawer.indexOf("async function applySelected"));
    assert.ok(successIndex > 0 && successIndex < catchIndex);
    assert.match(drawer, /Applied \$\{result\.appliedCount\} Recipe Copilot change/);
    assert.match(drawer, /Your proposal is still available\. No recipe fields were changed\./);
    assert.doesNotMatch(drawer.slice(catchIndex, drawer.indexOf("async function operate")), /setSelected/);
    assert.match(drawer, /stableRecipeProposalChangeId/);
    assert.match(drawer, /const selectedChanges = reviewChanges\.filter/);
  });

  it("26-35. commits to the active custom draft, reruns analysis, exposes rules, stays dirty, and does not persist or activate", () => {
    assert.match(studio, /setDraft\(result\.draft\)/);
    assert.match(studio, /setAnalysisState\("stale"\)/);
    assert.match(studio, /data-recipe-path="filters\.rules"/);
    assert.match(studio, /const dirty = useMemo/);
    assert.match(studio, /onApplyChanges=\{applyCopilotChanges\}/);
    assert.match(studio, /Save draft/);
    assert.doesNotMatch(applyService, /playlistRecipe\.update|updatePlaylistRecipeData|enabled:\s*false/);
    assert.match(applyService, /persisted:\s*false/);
    assert.match(applyService, /findRecipeProposalConflicts/);
    assert.match(applyService, /playlistRecipeSchema\.safeParse/);
  });
});
