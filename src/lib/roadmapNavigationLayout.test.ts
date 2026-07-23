import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), "utf8");
}

function ruleBlock(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = withoutComments.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected to find a CSS rule for "${selector}"`);
  return match![1];
}

describe("roadmap release navigation", () => {
  const css = read("src", "app", "roadmap", "roadmap.module.css");
  const page = read("src", "app", "roadmap", "page.tsx");

  it("stays in normal document flow without sticky overlay styles", () => {
    const controls = ruleBlock(css, ".controls");

    assert.doesNotMatch(controls, /position:\s*(?:sticky|fixed)/);
    assert.doesNotMatch(controls, /(?:^|;)\s*(?:top|right|bottom|left|inset)(?:-[^:]*)?:/);
    assert.doesNotMatch(controls, /z-index\s*:/);
    assert.doesNotMatch(controls, /backdrop-filter\s*:/);
  });

  it("retains its visual layout and responsive wrapping", () => {
    const controls = ruleBlock(css, ".controls");

    assert.match(controls, /display:\s*flex/);
    assert.match(controls, /flex-wrap:\s*wrap/);
    assert.match(controls, /gap\s*:/);
    assert.match(controls, /padding\s*:/);
    assert.match(controls, /border\s*:/);
    assert.match(controls, /border-radius\s*:/);
    assert.match(controls, /background\s*:/);
  });

  it("remains directly after the roadmap introduction with all five section links", () => {
    const heroIndex = page.indexOf("className={styles.hero}");
    const controlsIndex = page.indexOf("className={styles.controls}");
    const currentSectionIndex = page.indexOf('id="current"');

    assert.ok(heroIndex >= 0 && heroIndex < controlsIndex);
    assert.ok(controlsIndex < currentSectionIndex);

    for (const [label, target] of [
      ["Current", "current"],
      ["Next", "next"],
      ["Future", "future"],
      ["Completed", "completed"],
      ["All releases", "all-releases"],
    ]) {
      assert.match(page, new RegExp(`<a href="#${target}">${label}</a>`));
      assert.match(page, new RegExp(`id="${target}"`));
    }
  });
});
