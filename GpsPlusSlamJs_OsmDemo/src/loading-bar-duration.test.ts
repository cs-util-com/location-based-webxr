/**
 * The loading bar and the overlay's overrun switch must measure the same span.
 *
 * WHY THIS TEST EXISTS. The bar is a CSS animation over `--t-loading-bar`,
 * and the switch to the overrun sweep is a `setTimeout` over
 * `BAR_DURATION_MS`. Two numbers, two files, two languages, one
 * meaning - and the whole justification for that bar is that it measures
 * something honestly. If they drift, the fill starts sweeping while the bar still has
 * some to drain, or sits empty and still for seconds before it does, and
 * NOTHING fails: no type checks across a stylesheet, no e2e watches a 15 s
 * animation.
 *
 * This is the guard the plan's cold review asked for by name.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BAR_DURATION_MS } from "./loading-overlay.js";

/**
 * The VENDORED copy, which is what the page actually loads.
 *
 * `GpsPlusSlamJs_DesignSystem/design.css` is the canonical file and this is a
 * byte-verbatim copy of it (`pnpm run vendor`), held to that by the root
 * `design-css-copies.test.js`. Reading the copy is therefore equivalent AND
 * closer to the truth: it is the sheet `index.html` links.
 */
const designCss = readFileSync(
  new URL("../design.css", import.meta.url),
  "utf8",
);

/** `15s` / `250ms` -> milliseconds. */
function durationToMs(value: string, unit: string): number {
  return unit === "ms" ? Number(value) : Number(value) * 1_000;
}

describe("the loading bar's duration", () => {
  it("is the same in the stylesheet as in the code", () => {
    const declaration = /--t-loading-bar:\s*([\d.]+)(ms|s)\s*;/.exec(designCss);

    // A missing token is a real failure, not a skip: it would mean the bar has
    // no duration at all, which renders as an animation of 0s - an invisible
    // bar, and a test that quietly passed on nothing.
    expect(declaration, "--t-loading-bar is declared in design.css").not.toBe(
      null,
    );

    const [, value = "", unit = ""] = declaration ?? [];
    expect(durationToMs(value, unit)).toBe(BAR_DURATION_MS);
  });

  it("is what the bar's animation actually uses", () => {
    // The mirror of the test above, and it is not redundant: a token can agree
    // with the constant perfectly while the animation that draws the bar uses a
    // hard-coded duration beside it. Then the bar would drain on one schedule
    // while the overlay switched to its overrun sweep on another, and the first
    // test would still pass.
    const rule = /\.loading-overlay-fill\s*\{([^}]*)\}/.exec(designCss);

    expect(rule, ".loading-overlay-fill is defined").not.toBe(null);
    expect(rule?.[1] ?? "").toContain("var(--t-loading-bar)");
  });
});
