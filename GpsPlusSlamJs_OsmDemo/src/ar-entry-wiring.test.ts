/**
 * Guardrail: the AR entry's readiness signals are actually CONNECTED in
 * `main.ts` (DEC-M1, DEC-M4).
 *
 * WHY SOURCE TEXT, and it is the same argument `ar-walk-wiring.test.ts` makes at
 * length: `main.ts` builds a Leaflet map, a `WebGLRenderer` and a worker, so the
 * unit suite cannot run it, and headless Chromium has no WebXR device, so the
 * e2e cannot reach the AR path either. A static check is what is left.
 *
 * WHY IT IS WORTH HAVING HERE IN PARTICULAR. Both decisions this file guards
 * are of the shape "a value already computed correctly somewhere is never
 * handed to the thing that needs it":
 *
 * - the entry pass settles and nothing told the veil (DEC-M1), and
 * - the terrain field is replaced and nothing re-derives the quest marks
 *   (DEC-M4) — which is the ~100 m defect the eighteenth field session
 *   reported, and which every green gate in this repo missed because each
 *   module was correct in isolation.
 *
 * WHAT IT CANNOT DO: prove the calls RUN, or that their arguments are right.
 * `ar-mode.test.ts` owns the veil's behaviour and
 * `quest-beacon-placement.test.ts` owns the placement arithmetic. This only
 * closes the gap between "each piece works" and "the app uses them".
 *
 * @see ar-entry-dom-veil.ts.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, "main.ts"), "utf-8");

/** Source with comments stripped, so a mention in prose cannot satisfy a guard. */
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the AR entry readiness gate is wired into main.ts (DEC-M1)", () => {
  it("hands `startArMode` a getter for the entry pass having settled", () => {
    // Without this the veil gates on the alignment alone and uncovers while the
    // city on screen is still the one built for the DESKTOP datum.
    expect(CODE).toMatch(/entryContentReady:\s*\(\)\s*=>\s*arContentReady/);
  });

  it("sets the flag from the promise startWalking created, on BOTH settle paths", () => {
    // `finally`, not `then`: a failed fetch that left this false would hold
    // every later entry to the 8 s ceiling for the rest of the page's life.
    //
    // AND FROM A LOCAL, not from `currentPass` — the position subscriber and
    // the session teardown both reassign that, so attaching to it would set the
    // flag on whichever pass happened to be current instead of on the entry's.
    expect(CODE).toMatch(
      /const entryPass = runPassFor\([\s\S]{0,400}?entryPass\.finally\(\(\) => \{\s*arContentReady = true;/,
    );
  });

  it("clears the flag when an entry STARTS, not only when one ends", () => {
    // A second AR entry in the same page session would otherwise inherit the
    // first one's `true` and uncover before its own rebuild had run.
    expect(CODE).toMatch(
      /const enterAr = [\s\S]{0,400}?arContentReady = false;/,
    );
  });

  it("reports how long the wait took, so the ceiling can be measured", () => {
    // DEC-M1a. `ENTRY_READY_MAX_WAIT_S` is a guess; a field session that comes
    // back with "gave up waiting" is one where the ceiling, not the readiness,
    // ended the black screen — and that is the number the next run has to
    // bring back.
    expect(CODE).toMatch(/onEntryReady:/);
  });
});

describe("the quest marks are re-derived with the terrain field (DEC-M4)", () => {
  it("re-derives the held event's placements where the field is applied", () => {
    // THE DEFECT THIS EXISTS FOR. `setQuestBeacons` had exactly one call site —
    // the `geoEvent` subscriber — so the marks were placed once, against the
    // field as it stood then. AR entry replaces that field with one on a
    // different datum and rebuilds everything else against it; the marks kept
    // the old one and ended up ~100 m below the city.
    //
    // Asserted on the terrain-apply path specifically, because re-deriving in
    // the subscriber alone is exactly the state this fixes.
    expect(CODE).toMatch(/apply:\s*\(\{[\s\S]{0,4000}?drawQuestBeacons\(\)/);
  });

  it("draws them from ONE function, so the two triggers cannot disagree", () => {
    // The two triggers answer different questions — "the quest changed" and
    // "the ground under it changed" — and two copies of the placement call is
    // how they would drift. There is exactly one `setQuestBeacons` call site,
    // and both triggers go through it.
    expect(CODE.match(/buildingView\.setQuestBeacons\(/g)?.length ?? 0).toBe(1);
    expect(
      CODE.match(/drawQuestBeacons\(\);/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    // AND IT READS THE EVENT FROM THE STORE, so there is no second copy of
    // "which quest is held" for the terrain path to get wrong.
    expect(CODE).toMatch(
      /const drawQuestBeacons[\s\S]{0,200}?selectOsmView\(store\.getState\(\)\)\.geoEvent/,
    );
  });
});
