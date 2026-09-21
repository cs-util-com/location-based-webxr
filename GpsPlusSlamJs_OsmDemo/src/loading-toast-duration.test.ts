/**
 * The toast's bar and the toast's dismissal must measure the same span.
 *
 * WHY THIS TEST EXISTS. The loading toast's bar is a CSS animation over
 * `--t-toast-timed`, and its dismissal is a `setTimeout` over
 * `LOADING_TOAST_LINGER_MS`. Two numbers, two files, two languages, one
 * meaning - and the whole justification for that bar is that it measures
 * something honestly. If they drift, the bar empties while the toast is still
 * there, or the toast vanishes with the bar half full, and NOTHING fails: no
 * type checks across a stylesheet, no e2e watches a 15 s animation.
 *
 * This is the guard the plan's cold review asked for by name.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOADING_TOAST_LINGER_MS } from "./loading-announcer.js";

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

describe("the timed toast's duration", () => {
  it("is the same in the stylesheet as in the code", () => {
    const declaration = /--t-toast-timed:\s*([\d.]+)(ms|s)\s*;/.exec(designCss);

    // A missing token is a real failure, not a skip: it would mean the bar has
    // no duration at all, which renders as an animation of 0s - an invisible
    // bar, and a test that quietly passed on nothing.
    expect(declaration, "--t-toast-timed is declared in design.css").not.toBe(
      null,
    );

    const [, value = "", unit = ""] = declaration ?? [];
    expect(durationToMs(value, unit)).toBe(LOADING_TOAST_LINGER_MS);
  });

  it("is what the bar's animation actually uses", () => {
    // The mirror of the test above, and it is not redundant: a token can agree
    // with the constant perfectly while the animation that draws the bar uses a
    // hard-coded duration beside it. Then the two numbers a user compares -
    // bar and dismissal - still disagree, and the first test still passes.
    const rule = /\.toast--timed::after\s*\{([^}]*)\}/.exec(designCss);

    expect(rule, ".toast--timed::after is defined").not.toBe(null);
    expect(rule?.[1] ?? "").toContain("var(--t-toast-timed)");
  });
});
