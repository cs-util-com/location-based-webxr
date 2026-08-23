/**
 * The button's initial markup must say what the constant says.
 *
 * WHY THIS EXISTS, AND WHY IT DID NOT BEFORE. `index.html` renders the quest
 * button's resting label as literal text, and `event-label.ts` exports the same
 * string as `GEO_EVENT_IDLE_LABEL` — so the page shows the markup's copy until
 * the first repaint and the constant's copy thereafter. The two are a pair with
 * nothing holding them together.
 *
 * The round-two plan claimed "a test already pins the markup against the
 * constant". Its cold review checked, and that was false: the existing test
 * asserts the pure function returns the constant and never reads the markup at
 * all. The only thing linking them was a comment. This is the guard that was
 * assumed to exist.
 *
 * The failure it catches is quiet by construction — a stale word in the markup
 * is visible for a few hundred milliseconds on load, which is exactly long
 * enough for nobody to file it and long enough for a screenshot to disagree
 * with the code.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GEO_EVENT_IDLE_LABEL } from "./event-label.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markup = readFileSync(resolve(packageRoot, "index.html"), "utf8");

describe("the quest button's markup and its constant", () => {
  it("renders exactly GEO_EVENT_IDLE_LABEL as its initial text", () => {
    // Matched inside the button element rather than anywhere in the file, so a
    // coincidental mention in a comment cannot satisfy it.
    const button = /<button[^>]*id="geo-event"[^>]*>([\s\S]*?)<\/button>/.exec(
      markup,
    );

    expect(button, "no #geo-event button found in index.html").not.toBeNull();
    expect(button?.[1]?.trim()).toBe(GEO_EVENT_IDLE_LABEL);
  });

  it("does not still carry the pre-2026-08-19 wording anywhere", () => {
    // "Quests" is a UI string only (DEC-U11) — the code, the store and the
    // worker protocol all still say `geoEvent`, and `#geo-event` is still the
    // id. So this checks the VISIBLE wording specifically, not the identifier:
    // a leftover "Next geo-event" in the markup would be the old label
    // surviving the rename, which is the thing the test above cannot see if
    // someone adds a second button.
    expect(markup).not.toContain("Next geo-event");
  });
});
