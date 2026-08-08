/**
 * What a click in the 3D view selects (W12).
 *
 * WHY THIS IS ITS OWN MODULE. Picking used to be four lines inside
 * `BuildingView`, answering one question: which cell is under the pointer. W12
 * makes it answer "which *thing*", and the moment there are two kinds of answer
 * there is a precedence question, a nearest-hit question, and a "what happens
 * over a building" question — none of which can be tested through a class that
 * needs a `WebGLRenderer`.
 *
 * So the raycast stays in the view and the DECISION moves here, which is the
 * pattern this repo already uses for shader and worker logic: keep the judgement
 * in a pure module the device layer thinly wraps.
 *
 * THE INVARIANT THAT MUST SURVIVE: buildings are not selectable. That was a
 * deliberate choice — hitting a building should not silently select the cell
 * behind it *as if the building had been chosen* — and W12 must not undo it as a
 * side effect of making markers clickable.
 */

import { describe, expect, it } from "vitest";

import { resolvePick, type PickCandidate } from "./pick.js";

const MARKER = {
  feature: "node/4242",
  position: { x: 5, y: -7 },
  groundHeightM: 53,
  kind: "amenity=cafe",
  label: "Café Schmitz",
};

/** A hit on the affordance grid at `distance`, over triangle `faceIndex`. */
function cellHit(distance: number, faceIndex: number): PickCandidate {
  return { distance, faceIndex, userData: { cellGrid: true } };
}

/**
 * A hit on a POI pin at `distance`.
 *
 * INSTANCED since W7: the markers share one `InstancedMesh`, so `userData` can
 * no longer carry "the" marker — it carries the whole list, and the hit's
 * `instanceId` selects one. Exactly the shape the cell grid already uses, where
 * `faceIndex` indexes `cellForTriangle`.
 */
function poiHit(
  distance: number,
  instanceId = 0,
  markers = [MARKER],
): PickCandidate {
  return { distance, instanceId, userData: { poiInstances: markers } };
}

const CELLS = ["cell-a", "cell-b", "cell-c"];

describe("resolvePick", () => {
  it("returns the cell under a grid hit", () => {
    expect(resolvePick([cellHit(10, 1)], CELLS)).toEqual({
      kind: "cell",
      cell: "cell-b",
    });
  });

  it("returns the marker under a POI hit", () => {
    // The marker itself, not an id to look up. A lookup by index would be read
    // against whatever working set is current when the panel opens, which is not
    // necessarily the one the user clicked.
    expect(resolvePick([poiHit(5)], CELLS)).toEqual({
      kind: "poi",
      marker: MARKER,
    });
  });

  it("prefers the NEAREST hit, whichever kind it is", () => {
    // A marker stands on the grid, so a click on the marker hits both. Distance
    // is the only honest tie-break: preferring one kind by rule would make the
    // grid unclickable wherever a marker happens to overlap it, or make markers
    // unclickable entirely.
    expect(resolvePick([poiHit(5), cellHit(10, 0)], CELLS)).toEqual({
      kind: "poi",
      marker: MARKER,
    });
    expect(resolvePick([cellHit(3, 2), poiHit(9)], CELLS)).toEqual({
      kind: "cell",
      cell: "cell-c",
    });
  });

  it("does not assume the caller sorted the hits", () => {
    // three's `intersectObjects` does sort by distance, but relying on that makes
    // this module's contract depend on a detail of the caller's caller.
    expect(resolvePick([cellHit(30, 0), poiHit(2)], CELLS)).toEqual({
      kind: "poi",
      marker: MARKER,
    });
  });

  it("returns nothing when nothing was hit", () => {
    expect(resolvePick([], CELLS)).toBeUndefined();
  });

  it("ignores a hit it cannot identify, and keeps looking behind it", () => {
    // A BUILDING is the case this exists for. Buildings are excluded from the
    // raycast set upstream, so this is defence in depth — but if one ever does
    // arrive, it must neither be returned nor swallow the click. Silently
    // selecting nothing because an unselectable thing was in front would read as
    // a dead control.
    const building: PickCandidate = { distance: 1, userData: {} };
    expect(resolvePick([building, cellHit(10, 0)], CELLS)).toEqual({
      kind: "cell",
      cell: "cell-a",
    });
  });

  it("ignores a grid hit whose triangle maps to no cell", () => {
    // `cellForTriangle` is built in the same pass as the geometry, so a miss
    // means the two have drifted — and a drifted lookup opens the details panel
    // on a confidently wrong cell, which is worse than opening nothing. The H3
    // ragged-boundary fix landed for exactly this class of error.
    expect(resolvePick([cellHit(10, 99)], CELLS)).toBeUndefined();
  });

  it("survives a null faceIndex, which is what three's types actually say", () => {
    // `faceIndex` is `number | null` — null when the hit object has no indexed
    // faces. `cellForTriangle[null]` is `undefined` in JS but the narrowing has
    // to be explicit or the value flows on untyped.
    expect(
      resolvePick(
        [{ distance: 1, faceIndex: null, userData: { cellGrid: true } }],
        CELLS,
      ),
    ).toBeUndefined();
  });
});

describe("resolvePick — instanced POI markers (W7)", () => {
  const A = { ...MARKER, feature: "node/1", label: "Bakery" };
  const B = { ...MARKER, feature: "node/2", label: "Bench" };
  const C = { ...MARKER, feature: "node/3", label: "Bin" };

  it("names the marker the instance id points at, not the first one", () => {
    // WHY THIS TEST MATTERS. Instancing collapses N objects onto one, so the
    // identity that used to sit on the clicked object now has to be recovered
    // from an index. Getting that wrong does not break the click — it opens the
    // details panel on a confidently WRONG place, which is the half-swapped
    // scene in its most damaging form. Asserting the middle instance is what
    // separates a real lookup from "return markers[0]".
    const pick = resolvePick([poiHit(3, 1, [A, B, C])], CELLS);
    expect(pick).toEqual({ kind: "poi", marker: B });
  });

  it("skips a hit whose instance id has no marker", () => {
    // The same rule the cell grid follows for a drifted `cellForTriangle`: a
    // lookup miss means the table and the geometry have diverged, and answering
    // from a diverged table is worse than answering nothing. The click keeps
    // looking behind it rather than dying.
    expect(resolvePick([poiHit(3, 7, [A])], CELLS)).toBeUndefined();
  });

  it("survives a null instanceId, which is what three's types say for a Mesh", () => {
    // `Intersection.instanceId` is `number | undefined`, and it is absent for
    // every hit on a non-instanced object — including the cell grid, which is
    // in the same raycast set.
    expect(
      resolvePick([{ distance: 1, userData: { poiInstances: [A] } }], CELLS),
    ).toBeUndefined();
  });

  it("still lets distance decide between a marker and the grid", () => {
    // The tie-break DEC-R3-21 depends on: a marker stands ON the grid, so a
    // click hits both. Preferring a KIND would make one of them unclickable
    // wherever they overlap.
    expect(resolvePick([poiHit(9, 0, [A]), cellHit(2, 1)], CELLS)).toEqual({
      kind: "cell",
      cell: "cell-b",
    });
    expect(resolvePick([poiHit(2, 0, [A]), cellHit(9, 1)], CELLS)).toEqual({
      kind: "poi",
      marker: A,
    });
  });
});

/**
 * WHY THESE TESTS MATTER (DEC-R7b-3a). Region slabs became clickable in round 8,
 * and a region is the first member of the raycast set that is not a fine-grained
 * claim. A slab covers every cell inside it BY CONSTRUCTION — it is a flood fill
 * over those cells — so the overlap is total rather than incidental, and the
 * distance rule that correctly arbitrates a marker against the grid gives the
 * wrong answer here at any angle where the slab is nearer.
 *
 * The failure mode is the nasty kind: correct from overhead, wrong at a grazing
 * angle, and reported as "clicking a cell sometimes opens the wrong panel".
 */
describe("resolvePick with region slabs", () => {
  const slab = (distance: number, region = "r1"): PickCandidate => ({
    distance,
    userData: { regionId: region },
  });
  const cellHit = (distance: number, faceIndex = 0): PickCandidate => ({
    distance,
    faceIndex,
    userData: { cellGrid: true },
  });

  it("selects a region when nothing sharper was hit", () => {
    expect(resolvePick([slab(5)], [])).toEqual({
      kind: "region",
      region: "r1",
    });
  });

  it("prefers a CELL even when the slab is nearer", () => {
    // The whole point. With the cells hidden the slab is the only hit and this
    // never fires; with them shown, a click must reach the finer claim from
    // every camera angle, not just from above.
    expect(resolvePick([slab(1), cellHit(9)], ["8d1fb46622d8dbf"])).toEqual({
      kind: "cell",
      cell: "8d1fb46622d8dbf",
    });
  });

  it("falls back to the region when the nearer cell hit is unidentifiable", () => {
    // A drifted `cellForTriangle` skips the cell. Answering with the region is
    // better than answering with nothing: the region is still true, and a dead
    // click reads as a broken control.
    expect(resolvePick([slab(5), cellHit(1, 42)], [])).toEqual({
      kind: "region",
      region: "r1",
    });
  });

  it("takes the NEAREST region when slabs overlap", () => {
    expect(resolvePick([slab(9, "far"), slab(2, "near")], [])).toEqual({
      kind: "region",
      region: "near",
    });
  });

  it("ignores a slab carrying an empty id rather than selecting nothing", () => {
    // `regionId` is built from the lowest-sorting cell, and an empty region
    // yields "". Selecting it would open a panel on a region that cannot be
    // found in the snapshot.
    expect(resolvePick([slab(1, "")], [])).toBeUndefined();
  });
});

/**
 * WHY THESE TESTS MATTER (DEC-R11-17). Stage 4 orders an agent by clicking a
 * DESTINATION — and until this landed there was nothing to click. The raycast
 * set excluded the ground **by construction**, and the affordance grid that
 * would otherwise have caught the click is off by default (DEC-R7b-6), so a
 * click on open ground resolved to `undefined`. "Click a destination" was not
 * implementable against this module at all.
 *
 * The fix keeps the original invariant's INTENT while satisfying the feature
 * literally, and both halves of that need pinning:
 *
 * - The ground is the **coarsest** claim. It answers only when nothing sharper
 *   was hit, which is the rule region slabs already follow one grain up.
 * - **A building BLOCKS.** It joins the raycast set but is never a destination:
 *   a click on a building resolves to nothing rather than to the ground behind
 *   it. That was the original comment's whole point ("hitting a building should
 *   not silently select the cell behind it"), and since stage 3 it has a second
 *   and harder reason — a building interior is unreachable, so routing there
 *   costs the full expansion cap to answer "no".
 */
describe("resolvePick with the ground (DEC-R11-17)", () => {
  const groundHit = (
    distance: number,
    point = { x: 12, y: 3, z: -40 },
  ): PickCandidate => ({ distance, point, userData: { ground: true } });
  const buildingHit = (distance: number): PickCandidate => ({
    distance,
    point: { x: 0, y: 20, z: 0 },
    userData: { solid: true },
  });
  const slab = (distance: number, region = "r1"): PickCandidate => ({
    distance,
    userData: { regionId: region },
  });

  it("returns the point on the ground when nothing else was hit", () => {
    // SCENE COORDINATES, not lat/lng. This module must stay constructible
    // without an ENU frame — the frame lives on the page, next to the anchor —
    // so the conversion happens at the caller and the reflection stays in one
    // place.
    expect(resolvePick([groundHit(30)], [])).toEqual({
      kind: "ground",
      point: { x: 12, y: 3, z: -40 },
    });
  });

  it("lets a CELL win at any distance, because it is a precise claim", () => {
    // The ground is under EVERYTHING, so without this rule it would swallow the
    // demo's existing click behaviour the moment it joined the set. A grazing
    // camera angle is what makes "nearest wins" the wrong rule here — the same
    // reason region slabs are not peers.
    expect(
      resolvePick(
        [
          groundHit(1),
          // `faceIndex` spelled out: without it the grid hit resolves to no
          // cell and is skipped, and the assertion would pass for a ground
          // rule that had no precedence logic at all.
          { distance: 9, faceIndex: 0, userData: { cellGrid: true } },
        ],
        ["cell-a"],
      ),
    ).toEqual({ kind: "cell", cell: "cell-a" });
  });

  it("BEATS a region, which is DEC-R11-21 reversing what stage 4 first shipped", () => {
    // WHY THIS TEST MATTERS, AND WHY IT ASSERTS THE OPPOSITE OF THE OBVIOUS.
    // Finest-claim-wins would put a region above the ground, and that is how
    // this shipped for exactly one commit. Measured against the running demo it
    // made the feature unusable: the affordance slabs blanket everything near
    // the user at the demo's opening view, so EVERY click resolved to a region
    // and the agent could never be ordered anywhere at all.
    //
    // A cell and a marker still win (above) — they are precise claims the user
    // aimed at. A region is a flood fill hundreds of metres across, where
    // "I clicked in the big translucent area" much more often means "go there".
    expect(resolvePick([groundHit(1), slab(9)], [])).toEqual({
      kind: "ground",
      point: { x: 12, y: 3, z: -40 },
    });
    // And distance does not rescue it: the slab in front loses too.
    expect(resolvePick([slab(1), groundHit(9)], [])).toEqual({
      kind: "ground",
      point: { x: 12, y: 3, z: -40 },
    });
  });

  it("still selects a region when there is NO ground hit", () => {
    // The fallback that keeps DEC-R7b-3a alive in 3D rather than deleting it.
    // `building-view.ts` leaves a HIDDEN ground plane out of the raycast set —
    // the "none" ground mode exists so the OSM plates can be inspected on their
    // own — and with no ground under it the slab really is the thing that was
    // clicked. Without this, the region branch would be unreachable code.
    expect(resolvePick([slab(4)], [])).toEqual({
      kind: "region",
      region: "r1",
    });
  });

  it("refuses a destination when a building is in front of the ground", () => {
    // THE ASSERTION DEC-R11-17 EXISTS FOR. Routing to the ground behind a
    // clicked building sends the agent somewhere the user did not point at —
    // and that somewhere is usually inside the footprint, which is unreachable,
    // so the click also costs a full exhaustive search to answer "no route".
    expect(resolvePick([buildingHit(5), groundHit(20)], [])).toBeUndefined();
  });

  it("still answers when the building is BEHIND what was clicked", () => {
    // The blocking rule must be about occlusion, not about presence. A building
    // further away than the ground the user actually clicked is simply scenery.
    expect(resolvePick([groundHit(5), buildingHit(20)], [])).toEqual({
      kind: "ground",
      point: { x: 12, y: 3, z: -40 },
    });
  });

  it("lets a marker in front of a building still be selected", () => {
    // A POI pin standing against a facade is the everyday case. The blocker
    // must not reach past things that are nearer than it, or W12's markers stop
    // working next to every building in the city.
    const poi = {
      distance: 2,
      instanceId: 0,
      userData: { poiInstances: [MARKER] },
    };
    expect(resolvePick([poi, buildingHit(5), groundHit(20)], [])).toEqual({
      kind: "poi",
      marker: MARKER,
    });
  });

  it("keeps a region the user clicked in front of a building", () => {
    // A remembered region is a claim already made by the time the blocker is
    // reached. Dropping it would make regions unclickable wherever a building
    // stands behind them, which is most of the city.
    //
    // The ground here is BEHIND the building, so it never gets remembered — the
    // scan stops at the blocker. That is the whole point: the destination
    // behind a facade must not be reachable, and the region in front still is.
    expect(resolvePick([slab(2), buildingHit(5), groundHit(20)], [])).toEqual({
      kind: "region",
      region: "r1",
    });
  });

  it("ignores a ground hit that carries no point", () => {
    // Defensive: `Intersection.point` is always populated by three, but this
    // module is fed a reduced shape by hand at the boundary and a destination
    // without coordinates would post a route request for `undefined`.
    expect(
      resolvePick([{ distance: 5, userData: { ground: true } }], []),
    ).toBeUndefined();
  });
});
