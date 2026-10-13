/**
 * Why these tests matter: two things in `index.html` are load-bearing in a
 * way no other test can see, because they are properties of the MARKUP that
 * the stylesheet depends on. Both fail silently - the page still renders,
 * just wrong - and both are the kind of thing a formatter or a well-meaning
 * tidy-up changes without noticing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");

describe("the error line's tone comes from its content", () => {
  it("is authored with nothing at all inside it, so `:empty` matches", () => {
    // The failure family (red ground, dark ink) is applied by
    // `#error:not(:empty)` rather than by toggling `data-tone` at the eight
    // write sites that can fill this element. That is deliberate - an
    // attribute can drift out of step with the text, and `:empty` cannot -
    // but it buys that with a markup contract: ONE whitespace character
    // between the tags and the element is never `:empty`, so an empty error
    // box would paint a red bar on every load with no message in it.
    expect(html).toContain(
      '<div id="error" class="prose" role="alert" data-testid="error"></div>',
    );
  });
});

describe("the AR overlay root is not clipped", () => {
  it("step 4 overrides the shared card's overflow", () => {
    // `#step-measure` wears `.step`, which is `overflow: hidden`, and its
    // content is `#ar-root` - the element WebXR composites over the camera.
    // Whether the overlay's top-layer promotion escapes an ancestor's clip
    // is not something this suite can answer, and the place it would be
    // answered is a phone in someone's hand.
    expect(html).toMatch(/#step-measure\s*\{[^}]*overflow:\s*visible/);
  });

  it("prints the codes by PDF only: no print stylesheet, no print button", () => {
    // Polish round M0b (A10): the browser's print dialog owns a "fit to
    // page" that rescales, and a rescaled code measures the world wrong.
    // The page printed a code itself until then - with its own hazards, the
    // worst being the shared `.step` atom turning step 3 into the print
    // layout's containing block and clip. The PDF declares its own page, so
    // the page must not offer the other route again.
    expect(html).not.toMatch(/@media\s+print/);
    expect(html).not.toContain('id="print-button"');
    expect(html).not.toContain("window.print");
  });

  it("keeps the summary out of the page while a session runs", () => {
    // Half of the no-collapse guarantee (wizard.ts holds the other half):
    // `display: none` on the summary takes it out of the tab order and the
    // accessibility tree too, so neither a tap nor Enter can collapse the
    // step the overlay lives in.
    expect(html).toMatch(
      /body\[data-ar-active="true"\]\s+#step-measure\s*>\s*summary\s*\{\s*display:\s*none/,
    );
  });
});
