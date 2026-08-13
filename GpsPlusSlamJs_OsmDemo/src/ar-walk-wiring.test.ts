/**
 * Guardrail: the walking pieces are actually CONNECTED in `main.ts`.
 *
 * WHY THIS FILE EXISTS, stated as precisely as it can be. AR milestone 1 of
 * this plan shipped with three of its central claims false — `setZeroPos` had
 * no dispatcher, `toDemoLatLng` had no production caller, `geoidUndulationM`
 * had no producer — and **four green gates passed all three**. Every module was
 * correct in isolation; nothing asserted they were wired together. Milestone 3
 * adds four more connection points with exactly that shape.
 *
 * WHY SOURCE TEXT rather than behaviour. `main.ts` is the app entry: it
 * constructs a Leaflet map, a `WebGLRenderer` and a worker, so the unit suite
 * cannot run it. And the e2e cannot reach the AR path either — headless
 * Chromium has no WebXR device, so `requestSession` never resolves however the
 * support probe is stubbed. That leaves a static check, which is the same
 * conclusion `building-view-content.test.ts` reached for the same reason, with
 * the same precedent behind it (`agent-loop-config.test.ts`,
 * `internal-subpath-guardrail.test.ts`, `ip-guardrail.test.ts`).
 *
 * WHAT IT CANNOT DO, said plainly so nobody reads more into a green run: it
 * proves the call is WRITTEN, not that it runs, and not that its arguments are
 * right. The behaviour of each piece is pinned by `ar-walking.test.ts`,
 * `ar-walk-controller.test.ts` and `scene-anchor.test.ts`. This only closes the
 * gap between "each piece works" and "the app uses them" — which is precisely
 * the gap that cost milestone 1 two review rounds.
 *
 * @see ar-walk-controller.ts.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, "main.ts"), "utf-8");

/** Source with comments stripped, so a mention in prose cannot satisfy a guard. */
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("AR walking is wired into main.ts", () => {
  it("freezes the scene anchor while a session is live", () => {
    // Without this, `nextAnchor` still re-anchors on DISTANCE past 5 km — a
    // long walk moves the scene frame while the framework's `zero` cannot
    // follow, and the city jumps by kilometres. The option existing and being
    // tested proves nothing if no call site passes it.
    expect(CODE).toMatch(/anchors\.advance\([\s\S]{0,200}?frozen:/);
  });

  it("routes fixes through the gate INSTEAD OF the ungated path, not alongside it", () => {
    // THE STARVATION BUG, and the word that carries this guard is "instead"
    // (r509 review). The first version asserted only that
    // `arWalk.positionChanged` appeared — so deleting the `return;` beneath it
    // left all six assertions green while the gated call AND the ungated
    // dispatch both ran on every fix, i.e. the bug fully restored.
    //
    // So the assertion is on the SHORT CIRCUIT: the AR branch must hand the fix
    // to the controller and then leave, before the ungated
    // `store.dispatch(actions.positionChanged(...))` below it.
    const branch = CODE.match(
      /if \(arWalk !== undefined\) \{[\s\S]*?\n {6}\}/,
    )?.[0];
    expect(branch).toBeDefined();
    expect(branch).toContain("arWalk.positionChanged(position)");
    expect(branch).toContain("return;");
    // And it must come BEFORE the ungated dispatch, not after it.
    const gateAt = CODE.indexOf("if (arWalk !== undefined)");
    const dispatchAt = CODE.indexOf(
      "store.dispatch(actions.positionChanged(position))",
    );
    expect(gateAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(gateAt);
  });

  it("starts the GPS watch and the controller TOGETHER", () => {
    // The pairing is the safety property. A watch with no controller behind it
    // IS the starvation bug; a controller with no watch is a gate on a road
    // nobody drives on, so AR would simply never follow the user.
    const startWalking = CODE.match(/const startWalking[\s\S]*?\n {2}\};/)?.[0];
    expect(startWalking).toBeDefined();
    expect(startWalking).toContain("startArWalk(");
    expect(startWalking).toContain("locateControl.startWatch()");
  });

  it("drives BOTH loadTerrain and refresh from one position, and settles on both", () => {
    // §2.6, and the mechanism is not obvious: the worker joins terrain and mesh
    // on EXACT lat/lng equality. Gating only `refresh` while `loadTerrain` runs
    // ungated on a newer fix leaves `needsTerrainFor` permanently true, and
    // every build waits out the full 15 s terrain timeout before drawing on
    // whatever field it happens to hold.
    //
    // `allSettled`, NOT `all` (r509 review). `Promise.all` rejects on the first
    // rejection, so a failing terrain load settles the pass while the refresh
    // is still running — reopening the gate so the next fix aborts the run that
    // was about to publish, which is the one thing the gate exists to prevent.
    const pass = CODE.match(/const runPassFor[\s\S]*?\n {2}\};/)?.[0];
    expect(pass).toBeDefined();
    expect(pass).toContain("loadTerrainForCurrentMode(position)");
    expect(pass).toContain("refresh()");
    expect(pass).toContain("allSettled");
  });

  it("runs one full pass on AR ENTRY, not just a terrain reload", () => {
    // The datum is baked into the building/tree/POI VERTICES by the worker's
    // `update` handler; the `terrain` handler only replaces the field and
    // settles the gate. So `reloadTerrainForMode()` on entry moved the ground
    // plane — which AR does not even draw — and left every building at the
    // window-centre datum, i.e. the ~98 m error §2.5 exists to remove, wearing
    // a fusion bug's clothes (r509 review).
    //
    // Without this the datum would first apply after 100 m of walking, and
    // never at all for a user who stands still.
    const startWalking = CODE.match(/const startWalking[\s\S]*?\n {2}\};/)?.[0];
    expect(startWalking).toContain("runPassFor(");
  });

  it("stops walking on the BACK GESTURE as well as the exit button", () => {
    // `onEnded` fires for the Android back gesture, where nothing calls
    // `dispose()`. A watch left running there keeps draining the battery and
    // keeps resampling terrain against an AR datum the desktop view no longer
    // uses — and it is invisible, because the map still works.
    //
    // Asserted as TWO call sites, because one is exactly what the split
    // teardown in milestone 1 had.
    const stops = CODE.match(/stopWalking\(\)/g) ?? [];
    // Three: the definition's own name does not match (it is `const
    // stopWalking =`), so these are the click handler, `onEnded`, and none
    // other. Pinned as ">= 2" to name the requirement rather than the count.
    expect(stops.length).toBeGreaterThanOrEqual(2);
    const onEnded = CODE.match(/onEnded: \(\) => \{[\s\S]*?\},/)?.[0];
    expect(onEnded).toBeDefined();
    expect(onEnded).toContain("stopWalking()");
  });

  it("anchors the warning to `zero`, not to the scene anchor", () => {
    // They are different points. The far-travel warning is about drift from the
    // GPS frame the alignment matrix is expressed against — the framework's
    // `zero` — and measuring from `anchors.origin` would report a distance the
    // user's decision does not turn on.
    expect(CODE).toMatch(/startWalking\(\{\s*lat: zero\.lat,\s*lng: zero\.lon/);
  });
});

describe("AR measurement is wired into main.ts", () => {
  it("supplies the GPS-side numbers to the readout", () => {
    // `liveMeasurements` is OPTIONAL on `ArModeDeps`, so nothing in the type
    // system or in `ar-mode.test.ts` notices if `main.ts` stops passing it —
    // and the readout silently loses the two numbers the milestone exists to
    // read. That is precisely the M1 shape: correct in isolation, unasserted in
    // connection (r510 review).
    const call = CODE.match(/startArMode\(\{[\s\S]*?\n {4}\}\)/)?.[0];
    expect(call).toBeDefined();
    expect(call).toContain("liveMeasurements:");
    expect(call).toContain("fixAccuracyM");
    expect(call).toContain("metresFromAnchor");
  });

  it("measures the distance from the RAW fix, not the gated store position", () => {
    // While AR is live the store position only advances on fixes that clear the
    // 100 m gate, so reading it here would show "0 m from anchor" for the first
    // ~71 s of walking and then jump — a staircase of zeroes, which is exactly
    // what `ar-measurements.ts` refuses to print for a missing value, arriving
    // by another route (r510 review).
    expect(CODE).toContain("const here = lastFixPosition");
    expect(CODE).toMatch(/lastFixPosition = \{ lat: position\.lat/);
  });

  it("forgets the fix accuracy when the watch starts failing", () => {
    // A `watchPosition` outage fires `locationerror` about once a second while
    // `locationfound` stops. Without this the readout keeps showing the last
    // good `fix ±N m` for the rest of the session — worse than showing nothing,
    // because it is plausible.
    const onError = CODE.match(
      /onError: \(message\) => \{[\s\S]*?\n {4}\},/,
    )?.[0];
    expect(onError).toBeDefined();
    expect(onError).toContain("lastFixAccuracyM = undefined");
  });

  it("forgets the fix POSITION too, so the distance stops advancing", () => {
    // THE SECOND HALF OF THE SAME FIX, and it had no guard until the r511
    // review pointed out that this file asserted only the accuracy line
    // (r513). A stale `lastFixPosition` through an outage freezes
    // `metresFromAnchor` at whatever it last read — which is the more
    // misleading half, because a distance that stops moving reads as the user
    // having stopped walking rather than as the GPS having stopped answering.
    const onError = CODE.match(
      /onError: \(message\) => \{[\s\S]*?\n {4}\},/,
    )?.[0];
    expect(onError).toBeDefined();
    expect(onError).toContain("lastFixPosition = undefined");
  });

  it("routes the failure to the AR toast while a session is running", () => {
    // ALSO UNGUARDED UNTIL r513. The status line is outside WebXR's dom-overlay
    // root and is not composited during a session, so without this branch a GPS
    // failure while immersed is completely silent — the city simply stops
    // following the user. `arToast` appeared nowhere in this file, so deleting
    // the branch would have left the suite green.
    const onError = CODE.match(
      /onError: \(message\) => \{[\s\S]*?\n {4}\},/,
    )?.[0];
    expect(onError).toBeDefined();
    expect(onError).toMatch(
      /arSession !== undefined.*arToast\.show\(message\)/s,
    );
  });
});

describe("the desktop renderer's AR lifecycle is wired into main.ts", () => {
  it("suspends the desktop view on entry and resumes it on every exit", () => {
    // HIDDEN BUT RESIDENT (§3, M5). Suspending without resuming leaves the map
    // pane blank after a session with no error to explain it; resuming without
    // suspending leaves a second GL context repainting a 2.8 km city behind an
    // AR view nobody can see it through.
    //
    // The pairing is asserted by LOCATION, not just by presence: `startWalking`
    // and `stopWalking` are the two functions both AR exits already go through,
    // including the Android back gesture where nothing calls `dispose()`.
    const start = CODE.match(/const startWalking[\s\S]*?\n {2}\};/)?.[0];
    const stop = CODE.match(/const stopWalking[\s\S]*?\n {2}\};/)?.[0];
    expect(start).toContain("buildingView.suspend()");
    expect(stop).toContain("buildingView.resume()");
  });
});
