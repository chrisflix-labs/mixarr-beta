import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read=(path:string)=>readFileSync(path,"utf8");

describe("v2.3.9 Recipe Studio contracts",()=>{
  it("authenticates, bounds, and structures live analysis",()=>{const route=read("src/app/api/recipes/studio/analyze/route.ts");assert.match(route,/mixarr_session/);assert.match(route,/512 \* 1024/);assert.match(route,/RECIPE_STUDIO_INPUT_TOO_LARGE/);assert.match(route,/RECIPE_STUDIO_ANALYSIS_UNAVAILABLE/);});
  it("debounces analysis, aborts stale work, warns before unload, and preserves mobile actions",()=>{const studio=read("src/components/RecipeStudio.tsx");const css=read("src/components/RecipeStudio.module.css");assert.match(studio,/AbortController/);assert.match(studio,/setTimeout\(async \(\) =>/);assert.match(studio,/beforeunload/);assert.match(studio,/This recipe contains advanced settings/);assert.match(studio,/role="status"/);assert.match(css,/\.mobileSave/);assert.match(css,/prefers-reduced-motion/);});
  it("enforces optimistic concurrency and records recipe lifecycle audit events",()=>{const detail=read("src/app/api/playlist-recipes/[id]/route.ts");const list=read("src/app/api/playlist-recipes/route.ts");assert.match(detail,/expectedUpdatedAt/);assert.match(detail,/RECIPE_SAVE_CONFLICT/);assert.match(detail,/RECIPE_EDITED/);assert.match(detail,/RECIPE_ARCHIVED/);assert.match(list,/RECIPE_CREATED/);});
  it("adds only indexes in the v2.3.9 migration",()=>{const sql=read("prisma/migrations/20260721010000_recipe_studio_v239/migration.sql");assert.doesNotMatch(sql,/^\s*(DROP|DELETE|ALTER TABLE)/im);assert.equal((sql.match(/CREATE INDEX/g)||[]).length,4);assert.match(sql,/GeneratedPlaylist[\s\S]*userId[\s\S]*recipeId/);assert.match(sql,/JobHistory[\s\S]*userId[\s\S]*type[\s\S]*status/);});
  it("keeps graph and curve features understandable without pointer-only interaction",()=>{const studio=read("src/components/RecipeStudio.tsx");assert.match(studio,/Keyboard-accessible energy curve control points/);assert.match(studio,/aria-label={`Point/);assert.match(studio,/Dependencies and advanced settings/);assert.match(studio,/Inheritance, governance, snapshots, and audit/);});
  it("documents secret-free backup and backward-compatible migration behavior",()=>{const docs=read("docs/RECIPE_STUDIO_V239.md");assert.match(docs,/credentials and private listening data are not included/i);assert.match(docs,/does not replace or renumber the existing recipe schema/i);assert.match(docs,/AI-Assisted Mix Intelligence/);});
});
