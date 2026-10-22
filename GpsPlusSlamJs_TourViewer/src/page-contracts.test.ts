/**
 * Why these tests matter: things in `index.html` and `edit.html` are load-bearing in a
 * way no other test can see, because they are properties of the MARKUP that
 * the stylesheet depends on. Both fail silently - the page still renders,
 * just wrong - and both are the kind of thing a formatter or a well-meaning
 * tidy-up changes without noticing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkTourTitle,
  TOUR_CONTACT_MAX_CHARS,
  TOUR_DESCRIPTION_MAX_CHARS,
  TOUR_TITLE_MAX_CHARS,
} from "gps-plus-slam-app-framework/ar/tour-details";

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

describe("the desktop's details fields hold every value the format accepts", () => {
  // The r875 milestone review #8: `maxlength` counts UTF-16 code units,
  // the format (`checkTourTitle` and its siblings) counts code points, and
  // a character outside the Basic Multilingual Plane - an emoji, a rare
  // CJK ideograph - is two units and one point. A field capped at the
  // format's number therefore stopped a name of 80 such characters at 40,
  // a name the format accepts. The cap is twice the format's, so the
  // browser never refuses what the format keeps; the save's check
  // (`checkDetailsForm`) decides, and says why in words.
  const edit = readFileSync(resolve(packageRoot, "edit.html"), "utf8");
  function maxLengthOf(id: string): number {
    const tag = new RegExp(
      String.raw`<(?:input|textarea)\s[^>]*id="${id}"[^>]*>`,
    ).exec(edit)?.[0];
    const cap = tag === undefined ? undefined : /maxlength="(\d+)"/.exec(tag);
    if (cap?.[1] === undefined) throw new Error(`#${id} has no maxlength`);
    return Number(cap[1]);
  }

  it.each([
    ["details-name", TOUR_TITLE_MAX_CHARS],
    ["details-description", TOUR_DESCRIPTION_MAX_CHARS],
    ["details-contact", TOUR_CONTACT_MAX_CHARS],
  ])("#%s fits %d characters of two code units each", (id, max) => {
    expect(maxLengthOf(id)).toBeGreaterThanOrEqual(2 * max);
  });

  it("fits a name of 80 emoji, which the format accepts", () => {
    const name = "\u{1F5FA}".repeat(TOUR_TITLE_MAX_CHARS);
    expect(checkTourTitle(name).ok).toBe(true);
    expect(name.length).toBeLessThanOrEqual(maxLengthOf("details-name"));
    // One more and the format refuses: the cap is not where it stops.
    expect(checkTourTitle(`${name}\u{1F5FA}`).ok).toBe(false);
  });
});

describe("the visitor walk keeps out of the design system's walk classes", () => {
  // Why (visitor walk W4 build plan M2, §1.2): design.css ships `.radar`,
  // `.toast` and `.hint` with their own positions and looks. The walk
  // restates W4's look on its own classes; an element carrying one of
  // those would take the design system's position over the camera, and
  // the framework toast would wear `.toast` by default unless told not to.
  it("no element carries the class radar, toast or hint", () => {
    const classes = [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) =>
      (m[1] ?? "").split(/\s+/),
    );
    expect(
      classes.filter((c) => ["radar", "toast", "hint"].includes(c)),
    ).toEqual([]);
  });

  it("the walk's toast is created with its own class", () => {
    const main = readFileSync(resolve(packageRoot, "src/main.ts"), "utf8");
    expect(main).toMatch(
      /createToast\(element\("walk-toast-root"\),\s*\{\s*className:\s*"walk-toast"/,
    );
  });
});
