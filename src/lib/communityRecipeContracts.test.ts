import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("v2.3.5 migration is additive and preserves existing recipes", () => {
  const sql = read("prisma/migrations/20260720070000_community_recipe_sharing_v235/migration.sql");
  assert.match(sql, /ADD COLUMN "communityRecipeId" TEXT/);
  assert.match(sql, /ADD COLUMN "communityOriginalChecksum" TEXT/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|force-reset/i);
});

test("all community imports share staged validation and server-side installation", () => {
  const service = read("src/lib/communityRecipes/service.ts");
  for (const route of ["validate/route.ts", "import/url/route.ts", "import/upload/route.ts", "official/route.ts"]) assert.match(read(`src/app/api/recipes/community/${route}`), /stageCommunity/);
  assert.match(service, /validateCommunityDocument/);
  assert.match(service, /status: "STAGED"/);
  assert.match(service, /expiresAt/);
  assert.match(service, /enabled: false/);
  assert.match(service, /mode: "manual"/);
  assert.match(service, /automationPolicy: \{ \.\.\.recipe\.automationPolicy, enabled: false/);
});

test("community UI requires explicit approval and displays trust, compatibility, attribution, and reporting", () => {
  const page = read("src/app/recipes/community/page.tsx"); const detail = read("src/app/recipes/[id]/page.tsx"); const css = read("src/app/recipes/community/community.module.css");
  assert.match(page, /Import for Local Review/);
  assert.match(page, /Recipe safety review/);
  assert.match(page, /Third-party community recipe/);
  assert.match(page, /minimumMixarrVersion/);
  assert.match(page, /Upload bundle/);
  assert.match(page, /Paste JSON or code/);
  assert.match(detail, /Report Recipe/);
  assert.match(detail, /Check for update/);
  assert.match(detail, /Mixarr did not create, endorse, or guarantee/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test("release documentation states the data-only security boundary", () => {
  assert.equal(JSON.parse(read("package.json")).version, "2.4.17");
  const docs = read("docs/COMMUNITY_RECIPE_SHARING_V235.md");
  assert.match(docs, /data-only/);
  assert.match(docs, /never contain or execute scripts, commands, credentials, environment variables, plugins, or installation hooks/);
  assert.match(docs, /Structurally valid/);
  assert.match(docs, /Guaranteed safe/);
  assert.match(read("CHANGELOG.md"), /v2\.3\.5 - Community Recipe Sharing/);
});
