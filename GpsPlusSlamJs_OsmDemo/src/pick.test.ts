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
