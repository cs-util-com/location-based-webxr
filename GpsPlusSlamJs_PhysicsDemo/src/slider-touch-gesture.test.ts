/**
 * Structural test for the replay-speed slider's touch behaviour.
 *
 * Why this test matters:
 * A native range input inside a panel the user swipes past is a touch trap —
 * on a phone the value follows the finger during a scroll (recorder field
 * feedback 2026-07-27, same bug class here). The fix has two halves: the
 * framework's `guardSliderAgainstScroll` (fully tested there, wired in
 * `main.ts`) and this `touch-action: pan-y` rule, which is what lets the page
 * scroll instead of the slider swallowing the gesture. Losing the rule brings
 * back the "cannot scroll past the panel" half of the bug silently, so it is
 * pinned here against the production HTML.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadIndexHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "../index.html"), "utf-8");
}

describe("replay-speed slider touch behaviour", () => {
  it("declares touch-action: pan-y for range inputs", () => {
    const rule = loadIndexHtml().match(
      /input\[type="range"\]\s*\{[^}]*?\}/s,
    )?.[0];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/touch-action:\s*pan-y/);
  });
});
