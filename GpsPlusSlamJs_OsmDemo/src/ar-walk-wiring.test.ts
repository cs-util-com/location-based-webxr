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

describe("the GPS→store→alignment loop is wired into main.ts", () => {
  // WHY THIS BLOCK EXISTS. The owner reported on 2026-08-14 that AR mode
  // "doesn't really use the AR framework — GPS events … dispatched into the
  // store … automatic alignments … missing entirely." It was: the demo had a
  // real 1 Hz watch whose fixes were spent on fetching and never on
  // registration. The behaviour now lives in `gps-registration.ts` and is
  // tested there; these guards only close the "is it CONNECTED" gap, which is
  // the gap that let the loop be absent for four milestones.

  it("registers every fix, NOT only the ones the refetch gate admits", () => {
    // THE SEPARATION IS THE FIX. Registration is per-fix; refetching waits for
    // 100 m. Conflating them again would re-solve the alignment once per 100 m
    // of walking instead of once per fix, so the city would lurch at each gate
    // opening rather than track the user.
    //
    // Asserted by ORDER, the same way the starvation guard above is: the
    // registration call must come BEFORE the `arWalk` short-circuit, or the
    // `return` skips it for every fix that does not open the gate.
    const registerAt = CODE.indexOf("gpsRegistration.onFix(");
    const gateAt = CODE.indexOf("if (arWalk !== undefined)");
    expect(registerAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(registerAt).toBeLessThan(gateAt);
  });

  it("starts and stops the registration with the watch that feeds it", () => {
    // Paired by LOCATION, like suspend/resume above: `startWalking` and
    // `stopWalking` are the two functions every AR entry and exit goes
    // through, including the Android back gesture. A registration that
    // outlived the watch would keep `isRecording` true, and then every desktop
    // locate fix afterwards would dispatch a GPS event against a null AR pose.
    const start = CODE.match(/const startWalking[\s\S]*?\n {2}\};/)?.[0];
    const stop = CODE.match(/const stopWalking[\s\S]*?\n {2}\};/)?.[0];
    expect(start).toContain("gpsRegistration.start()");
    expect(stop).toContain("gpsRegistration.stop()");
  });

  it("does NOT open a second GPS watch", () => {
    // `locate-control.ts` rejects this by name: two sources for the same fact
    // can disagree about which fix is current, and the alignment would then be
    // solved against positions the scene was never fetched for. The obvious
    // fix — copy `AnchorStarter` and call `startGpsWatch` on AR entry — is
    // exactly the wrong one here, so the guard is on its ABSENCE.
    expect(CODE).not.toContain("startGpsWatch");
  });

  it("re-bases the odometry when ARCore resets its origin", () => {
    // Harmless while no GPS events existed; load-bearing now. Without the
    // callback the framework drops the restart payload and the solve mixes two
    // incompatible odometry frames — the city jumps once and never
    // re-converges, which reads exactly like a broken fusion.
    const AR_MODE = readFileSync(path.join(HERE, "ar-mode.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(AR_MODE).toContain("onRestarted");
    expect(AR_MODE).toContain("odometryTrackingRestarted(");
  });
});

describe("the AR terrain datum is wired into main.ts", () => {
  // WHY THIS BLOCK EXISTS. The owner entered AR and was "flying roughly 50 m
  // above the OSM buildings"; on a second entry they were within ~4 m. That is
  // the signature of a mesh built against the wrong DATUM — the desktop view
  // measures heights from the window centre, AR measures them from the
  // ellipsoid, and the two are ~99 m apart at Cologne. The gate now treats the
  // datum as part of a field's identity; these guards cover the wiring that
  // feeds it, which is the half a unit test of the gate cannot see.

  it("resolves the geoid BEFORE the entry pass, not inside the terrain request", () => {
    // THE ORDERING IS THE FIX. The geoid is a dynamic import; sampling it
    // inside `loadTerrainForCurrentMode` meant the terrain path awaited a
    // module fetch while the mesh build posted immediately — so the mesh was
    // guaranteed to be built on the desktop field on a cold first entry.
    // Awaiting it on AR entry, before `startWalking`, is what removes the race.
    const entry = CODE.match(
      /if \(mode\.started && zero !== null\) \{[\s\S]*?\n {6}\}/,
    )?.[0];
    expect(entry).toBeDefined();
    // Matched on the AWAIT rather than on the assignment: the fix for the
    // session-end race split those two lines apart, and a guard pinned to one
    // exact spelling breaks on a change that keeps the property intact.
    expect(entry).toContain("await geoid()");
    const resolveAt = entry?.indexOf("await geoid()") ?? -1;
    const walkAt = entry?.indexOf("startWalking(") ?? -1;
    expect(resolveAt).toBeGreaterThan(-1);
    expect(walkAt).toBeGreaterThan(resolveAt);
  });

  it("clears the datum on the way out, so the exit pass rebuilds for the desktop", () => {
    // The mirror case. Leaving it set would keep the desktop view's buildings
    // at ellipsoidal heights while its camera is framed against a moving
    // surface — and the exit pass runs right after `stopWalking`.
    const stop = CODE.match(/const stopWalking[\s\S]*?\n {2}\};/)?.[0];
    expect(stop).toContain("arUndulationM = undefined");
  });

  it("gives the mesh build the SAME datum the terrain load uses", () => {
    // One held value, two readers. Two independent `undulationMetres` calls
    // would be two chances to disagree, and the worker's gate compares them —
    // so a disagreement would not merely be wrong, it would stall every AR
    // build on the gate's full timeout waiting for a field that never matches.
    expect(CODE).toContain("geoidUndulationM: () => arUndulationM");
    expect(CODE).toContain("geoidUndulationM: arUndulationM");
  });
});

describe("the geoid await cannot outlive its own AR session", () => {
  it("re-checks the session AFTER the await, before starting the walk", () => {
    // Why this guard matters (r515 review). Adding `await geoid()` to the AR
    // entry turned a synchronous `.then` body into an interleaving point, and
    // `onSessionEnd` is armed strictly BEFORE `startArMode` resolves — so the
    // back gesture can run the whole teardown while this is parked on a
    // ~176 KB dynamic import. Resuming blind starts a locate watch, a GPS
    // registration and an `arWalk` after their own stop, and leaves the
    // desktop 3D pane suspended with nothing to resume it.
    //
    // Asserted by ORDER, like the registration guard above: the check must sit
    // between the await and `startWalking`, or it proves nothing.
    const entry = CODE.match(
      /if \(mode\.started && zero !== null\) \{[\s\S]*?\n {6}\}/,
    )?.[0];
    expect(entry).toBeDefined();
    const awaitAt = entry?.indexOf("await geoid()") ?? -1;
    const guardAt = entry?.indexOf("if (arSession !== mode) return;") ?? -1;
    // THE DATUM WRITE IS IN THE CHAIN, and leaving it out was the hole this
    // guard most needed to close (r515 review). Assigning into a local first is
    // load-bearing: writing `arUndulationM` BEFORE the guard leaves the AR
    // datum applied to the desktop view for the rest of the page's life on the
    // stale path. With only await → guard → walk asserted, moving the
    // assignment back above the guard kept all three passing while fully
    // restoring the leak.
    //
    // Retargeting the previous assertion off `arUndulationM = (await geoid())`
    // is what opened it: that string was the only thing tying the datum write
    // to this path at all, and dropping it dropped the placement and the
    // provenance together.
    const writeAt = entry?.indexOf("arUndulationM = undulation") ?? -1;
    const walkAt = entry?.indexOf("startWalking(") ?? -1;
    expect(awaitAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(awaitAt);
    expect(writeAt).toBeGreaterThan(guardAt);
    expect(walkAt).toBeGreaterThan(writeAt);
  });
});

describe("a failed geoid import cannot leave a live session with no walk", () => {
  it("catches the import, reports it, and ends the session", () => {
    // Why this matters (r517 review). `geoid()` is a dynamic import of a
    // ~176 KB chunk over mobile data, on the one entry path the code itself
    // calls "a cold cache". An unhandled rejection skips `startWalking`
    // entirely — while `arSession = mode` and the "Exit AR" repaint have
    // already run — so there is no GPS registration, `recordGpsEvent` never
    // fires, and the alignment never leaves identity. That is the ORIGINAL bug
    // this change set fixed, reintroduced through a network failure.
    //
    // Refused rather than degraded: without the geoid the terrain datum cannot
    // be computed, and continuing would draw the city ~47 m out vertically.
    const entry = CODE.match(
      /if \(mode\.started && zero !== null\) \{[\s\S]*?\n {6}\}/,
    )?.[0];
    expect(entry).toBeDefined();
    expect(entry).toMatch(/try \{[\s\S]*?await geoid\(\)[\s\S]*?\} catch/);
    // And the failure path must both TELL the user and END the session —
    // either alone is the silent-failure shape this guards against.
    const failure = entry?.slice(entry.indexOf("} catch")) ?? "";
    expect(failure).toContain("arToast.show(");
    expect(failure).toContain("dispose()");
    expect(failure).toContain("return;");
  });
});

describe("the map zoom is wired to the 3D camera in main.ts", () => {
  /**
   * Why these tests matter: the conversion is unit-tested in
   * `map-zoom-to-camera.test.ts`, but a pure function nothing calls changes
   * nothing on screen. This is the M1 shape the AR-measurement guard above was
   * written for — correct in isolation, unasserted in connection — and the
   * connection here is a Leaflet event listener that no type checks.
   */
  it("listens on zoomEND, not on every frame of a pinch", () => {
    // `zoom` fires continuously through a pinch or an animated button press.
    // Re-aiming the camera on each one fights the gesture and rewrites the
    // shareable camera URL dozens of times per interaction. One event per
    // settled zoom is the contract, and the wrong event name is invisible
    // everywhere else — it would simply feel bad on a phone.
    expect(CODE).toContain('mapView.map.on("zoomend"');
    expect(CODE).not.toContain('mapView.map.on("zoom"');
  });

  it("dollies to the converted distance while KEEPING the camera's target", () => {
    // `lookAtFrom(cameraView().target, d)` preserves where the camera is
    // looking and changes only how far away it is. Passing a different target
    // would teleport the 3D view on every map zoom, and panning the map — which
    // the session did NOT ask to couple — would start moving the 3D scene.
    const handler = CODE.match(
      /mapView\.map\.on\("zoomend", \(\) => \{[\s\S]*?\n {2}\}\);/,
    )?.[0];
    expect(handler).toBeDefined();
    expect(handler).toContain("cameraDistanceForZoom({");
    expect(handler).toMatch(
      /lookAtFrom\(\s*buildingView\.cameraView\(\)\.target,\s*distanceM,?\s*\)/,
    );
  });

  it("feeds the conversion the map's own zoom, latitude and pane width", () => {
    // Each of these is in the formula for a reason and each is silently
    // substitutable with a plausible wrong value: a hardcoded latitude, the
    // window width instead of the map pane's, or a stale zoom. None would throw.
    const handler = CODE.match(
      /mapView\.map\.on\("zoomend", \(\) => \{[\s\S]*?\n {2}\}\);/,
    )?.[0];
    expect(handler).toContain("mapView.map.getZoom()");
    expect(handler).toContain("mapView.map.getCenter().lat");
    expect(handler).toContain("mapView.map.getContainer().clientWidth");
  });

  it("takes the field of view from the camera that actually renders", () => {
    // A second literal `55` here would stop agreeing with `building-view.ts`
    // the first time the FOV is tuned, and the two views would then disagree
    // about how much ground is on screen — the exact thing this feature exists
    // to make them agree about.
    expect(CODE).toContain("vfovDeg: CAMERA_VFOV_DEG");
    expect(CODE).not.toMatch(/vfovDeg:\s*55/);
  });
});
