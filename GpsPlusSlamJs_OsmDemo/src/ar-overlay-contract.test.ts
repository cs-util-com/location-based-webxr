import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The `dom-overlay` contract items the r541 field report ran into.
 *
 * **This file used to assert the opposite of what it now asserts**, and the
 * reversal is the useful part. It required `viewport-fit=cover` on the grounds
 * that `env(safe-area-inset-*)` returns 0 without it — true, and beside the
 * point, because nothing in this package reads a safe-area inset. Opting in also
 * extends the layout viewport UNDER the system bars, so the only LIVE effect was
 * to push a bottom-anchored bar further down: the wrong direction for the very
 * symptom it was meant to help. Caught in review of PR #333.
 *
 * What is pinned now is the COUPLING rather than either half, because either
 * half alone is a defect:
 *
 * - `cover` without a consumer moves content under the system bars for nothing.
 * - a consumer without `cover` silently resolves every inset to 0, which is CSS
 *   that reads as correct and does nothing.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_HTML = path.join(PACKAGE_ROOT, "index.html");

/** Source files that could plausibly carry the CSS, excluding build output. */
function styleSources(): string[] {
  const found: string[] = [];
  const skip = new Set(["node_modules", "dist", "test-results", "coverage"]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(html|css|ts)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(PACKAGE_ROOT);
  return found;
}

/**
 * Comments removed, so a rule is only counted when it is real CSS.
 *
 * **Stripping rather than prefix-matching**, and the first version got this
 * wrong: it skipped lines beginning with `*`, `/*`, `//` or `<!--`, which misses
 * the continuation lines of this repo's block comments — they are indented prose
 * with no leading `*`. The guard then reported `index.html` as a consumer on the
 * strength of a comment that merely MENTIONS `env(safe-area-inset-top)` while
 * explaining why the code deliberately does not use it. A guard that counts
 * prose is the same vacuity failure as one that counts nothing.
 */
function withoutComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** `env(safe-area-inset-…)` in real CSS, not in a comment explaining it. */
function safeAreaConsumers(): string[] {
  return styleSources().filter((file) =>
    withoutComments(readFileSync(file, "utf8")).includes("env(safe-area-inset"),
  );
}

describe("the dom-overlay viewport contract", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  const viewport = /<meta\s+name="viewport"[^>]*content="([^"]*)"/i.exec(html);
  const optsIntoCover = /viewport-fit\s*=\s*cover/.test(viewport?.[1] ?? "");

  it("has a viewport meta at all", () => {
    // Vacuity guard: every assertion below reads this tag, so a missing or
    // renamed one must fail loudly rather than make the checks trivially true.
    expect(viewport, "no viewport meta tag").not.toBeNull();
  });

  it("opts into viewport-fit=cover IF AND ONLY IF something reads a safe-area inset", () => {
    // ONE BICONDITIONAL, NOT TWO CONDITIONAL TESTS. The first version branched
    // on the current state and asserted inside each arm, which `vitest`'s
    // `no-conditional-expect` rightly rejects — and the rule was pointing at a
    // design flaw, not just a style one: a test that branches on the thing it is
    // checking passes trivially in whichever arm has no assertion worth making.
    //
    // Both directions are defects, which is why they belong in one statement:
    //
    // - `cover` with no consumer extends the layout viewport under the system
    //   bars and buys nothing — it pushes a bottom-anchored bar DOWN, the wrong
    //   direction for the symptom that motivated it (PR #333 review).
    // - a consumer without `cover` silently resolves every inset to 0, so the
    //   CSS reads as correct and does nothing at all.
    const consumers = safeAreaConsumers();
    expect(
      optsIntoCover,
      optsIntoCover
        ? "viewport-fit=cover is set but nothing reads env(safe-area-inset-*), so its only live effect is to push content under the system bars"
        : `these files read env(safe-area-inset-*) while the viewport meta omits viewport-fit=cover, so every inset resolves to 0: ${consumers.join(", ")}`,
    ).toBe(consumers.length > 0);
  });
});
