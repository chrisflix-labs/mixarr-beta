import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the shared application shell layout.
 *
 * Background: expanding several sidebar groups made the sidebar taller than the
 * viewport. With a fixed `height: 100vh` sidebar (no overflow) and a
 * `height: 100vh; overflow-y: auto` main-content, the oversized sidebar forced
 * the flex container — and therefore the document — taller than one viewport,
 * which clipped page content (e.g. the AI provider "Test inference" panel) and
 * hid the sidebar account card.
 *
 * The fix establishes a single, consistent desktop scrolling model:
 *   - the document scrolls naturally (main-content grows, no fixed height / no
 *     internal overflow),
 *   - the sidebar is sticky with `max-height: 100vh` + its own overflow scroll,
 *   - `overflow-x: clip` (not `hidden`) on html/body keeps sticky working while
 *     still preventing horizontal scrollbars.
 *
 * These assertions read the shared CSS directly (same approach as
 * dashboardWidgets.test.ts) so the model can't silently regress.
 */

function readCss(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), "utf8");
}

/** Extract the declaration block for the first rule matching `selector`. */
function ruleBlock(css: string, selector: string): string {
  // Strip comments so commented-out declarations don't cause false matches.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = withoutComments.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected to find a CSS rule for "${selector}"`);
  return match![1];
}

describe("app shell layout", () => {
  const globals = readCss("src", "app", "globals.css");
  const sidebar = readCss("src", "components", "Sidebar.module.css");

  it("lets the document grow instead of pinning it to one viewport", () => {
    const appContainer = ruleBlock(globals, ".app-container");
    assert.match(appContainer, /min-height:\s*100vh/, ".app-container should use min-height: 100vh");
    assert.doesNotMatch(appContainer, /(?<!min-)height:\s*100vh/, ".app-container must not force a fixed height: 100vh");
    assert.doesNotMatch(appContainer, /overflow[^:]*:\s*hidden/, ".app-container must not clip with overflow: hidden");
  });

  it("does not turn main-content into a fixed-height clipping scroll region", () => {
    const mainContent = ruleBlock(globals, ".main-content");
    // The document scrolls, so main-content must NOT be a fixed 100vh internal scroller.
    assert.doesNotMatch(mainContent, /height:\s*100vh/, ".main-content must not use height: 100vh");
    assert.doesNotMatch(mainContent, /overflow-y:\s*auto/, ".main-content must not create its own vertical scrollbar");
    // Flex child must be allowed to shrink so wide content can't cause horizontal overflow.
    assert.match(mainContent, /min-width:\s*0/, ".main-content should set min-width: 0");
    // Adequate bottom padding so the final control clears the viewport edge.
    assert.match(mainContent, /padding-bottom:/, ".main-content should keep bottom padding");
  });

  it("uses overflow-x: clip (not hidden) so the sticky sidebar keeps pinning", () => {
    const htmlBody = ruleBlock(globals, "html, body");
    assert.match(htmlBody, /overflow-x:\s*clip/, "html/body should use overflow-x: clip");
    assert.doesNotMatch(htmlBody, /overflow-x:\s*hidden/, "overflow-x: hidden on body breaks position: sticky");
  });

  it("caps the sidebar to the viewport and gives it its own scrollbar", () => {
    const rule = ruleBlock(sidebar, ".sidebar");
    assert.match(rule, /position:\s*sticky/, "sidebar should remain sticky on desktop");
    assert.match(rule, /max-height:\s*100vh/, "sidebar should cap at max-height: 100vh");
    // A bare fixed height would reintroduce the min-height:auto flex growth bug.
    assert.doesNotMatch(rule, /(?<!max-)height:\s*100vh/, "sidebar must not use a fixed height: 100vh");
    assert.match(rule, /overflow-y:\s*auto/, "sidebar should scroll its own overflow");
    assert.match(rule, /overflow-x:\s*hidden/, "sidebar inner scroll must not cause horizontal scrolling");
  });
});
