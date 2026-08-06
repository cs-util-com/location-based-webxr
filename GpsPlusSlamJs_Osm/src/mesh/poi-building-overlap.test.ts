/**
 * POI markers standing inside buildings that were already extruded — F33,
 * closed by §5 (DEC-R6-17).
 *
 * THE DEFECT. Some POI kinds are tall enough to be buildings in their own right,
 * and such a place is routinely mapped as BOTH a node and a building way. `poi.ts` marks nodes, `buildings.ts` extrudes
 * ways, neither knows about the other, and the result is a 15 m block standing
 * inside a building that is already there.
 *
 * WHY IT LANDS HERE AND NOT IN §4. DEC-R6-8 kept POI models at real-world scale
 * rather than adopting the plinth idiom, which would have solved this for free
 * by making every marker ~0.9 m. So it is fixed as what it structurally IS — a
 * volume drawn where another volume already stands, which is the same defect §5
 * fixes for building outlines.
 *
 * THE SET IS SHRINKING, AND ON PURPOSE. It was four kinds, then five when round 8
 * adopted `amenity=bank` at exactly 8.0 m, and it is down to two — `bank` and
 * `leisure=sports_centre` — as the symbol-language port replaces each
 * building-shaped marker with a ~2.5 m symbol. At zero this rule has nothing
 * left to suppress. Tests here therefore name a kind that still qualifies rather
 * than a kind that once did.
 *
 * THE ASSERTION THAT MATTERS MOST IS THE INVERSE ONE. A building-scale POI mapped
 * ONLY as a node — no building way anywhere — must still draw. Suppressing that would
 * turn a visible fix into an invisible data loss, and it is the easy mistake:
 * the obvious implementation drops every tall POI and looks correct on the one
 * fixture where a building happens to exist.
 */

import { describe, expect, it } from "vitest";

import { POI_MODELS, poiModelFor } from "./poi-models.js";
import {
  BUILDING_SCALE_POI_HEIGHT_M,
  isBuildingScalePoi,
  suppressPoiInsideBuildings,
  type PoiFootprintMarker,
} from "./poi-building-overlap.js";

/** A marker at an ENU position, of a given kind. */
function marker(kind: string, x: number, y: number): PoiFootprintMarker {
  return { feature: "node/1", kind, position: { x, y } };
}

/** A square footprint, centred on the origin unless moved. */
function square(size: number, cx = 0, cy = 0): { x: number; y: number }[] {
  const h = size / 2;
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ];
}

describe("isBuildingScalePoi", () => {
  it("selects NOTHING now, which is the symbol port finished", () => {
    // DERIVED FROM THE MODEL'S OWN HEIGHT, not from a hard-coded list of
    // strings. A tall model added later must be covered without anyone
    // remembering to update this — which is exactly what a literal list would
    // fail to do, silently.
    //
    // THE LIST SHRINKS AS THE SYMBOL PORT LANDS, and that is the port working
    // rather than this test rotting. `tourism=hotel` was here at 13.5 m until
    // batch A replaced it with a 2.5 m bed symbol; `amenity=bank` joined when
    // round 8 adopted it at exactly 8.0 m. It should reach EMPTY once all 27
    // winners are ported, at which point the suppression rule has nothing left
    // to suppress and this file's reason to exist can be revisited.
    const building = [...POI_MODELS.values()]
      .filter((model) => isBuildingScalePoi(model.kind))
      .map((model) => model.kind);
    expect(building).toEqual([]);
  });

  it("names the kinds that used to select, so the reversal is legible", () => {
    // Every one of these was a 8-15 m volume standing inside the building OSM
    // already draws. They are 2.5 m symbols now, and drawing one inside its own
    // building is no longer a duplicate — it is the label that building was
    // missing, which is what stage 1 will do with it.
    for (const kind of [
      "amenity=hospital",
      "tourism=hotel",
      "amenity=place_of_worship",
      "leisure=sports_centre",
      "amenity=bank",
    ]) {
      expect(poiModelFor(kind)).toBeDefined();
      expect(isBuildingScalePoi(kind)).toBe(false);
    }
  });

  it("leaves ordinary street furniture alone", () => {
    // A bench inside a building outline is a bench in a courtyard or an atrium,
    // and it is real. Only the kinds that DUPLICATE a building are suppressed.
    for (const kind of [
      "amenity=bench",
      "amenity=waste_basket",
      "amenity=cafe",
      "amenity=fountain",
      "leisure=picnic_table",
    ]) {
      expect(isBuildingScalePoi(kind)).toBe(false);
    }
  });

  it("says no for a kind with no model at all", () => {
    // The unmodelled tail draws a 6 m fallback cone, which is not a building
    // claim — and there are ~650 of them, so a wrong answer here is broad.
    expect(isBuildingScalePoi("amenity=nonexistent")).toBe(false);
  });

  it("uses a threshold high enough to exclude a shopfront", () => {
    // `amenity=restaurant` is 3.6 m and `amenity=cafe` 3 m — both are shopfront
    // models, both are legitimately inside a building, and a threshold that
    // caught them would delete most of a high street.
    expect(BUILDING_SCALE_POI_HEIGHT_M).toBeGreaterThan(7);
  });
});

describe("suppressPoiInsideBuildings", () => {
  /**
   * THIS RULE IS NOW INERT, AND THAT IS A STATED COVERAGE GAP RATHER THAN A
   * TIDY-UP.
   *
   * Every test that dropped a marker needed a kind that IS building-scale, and
   * after stage 0c none is: they all became ~2.5 m symbols. So
   * `suppressPoiInsideBuildings` iterates, matches nothing and returns its
   * input, and its point-in-polygon is unreachable from production.
   *
   * **The resolution is stage 1, not a stub.** That stage replaces this rule
   * with the layer-aware host resolver, which needs the same containment test
   * for a far wider set of markers and brings its own coverage. What is asserted
   * here meanwhile is the honest thing — that the rule is a no-op — and what is
   * owed is recorded as `todo` rather than deleted.
   */
  it("suppresses NOTHING today, because no kind is building-scale any more", () => {
    // THE CURRENT CONTRACT, asserted rather than assumed. After stage 0c every
    // kind that used to qualify is a ~2.5 m symbol, so this rule iterates,
    // matches nothing and returns its input unchanged — including a marker
    // standing dead centre of a footprint, which is the case it was written to
    // delete.
    const markers = [
      marker("amenity=hospital", 0, 0),
      marker("leisure=sports_centre", 0, 0),
      marker("amenity=bank", 0, 0),
    ];
    expect(suppressPoiInsideBuildings(markers, [square(40)])).toEqual(markers);
  });

  it("keeps a BENCH inside a building, because it is not a duplicate", () => {
    // An atrium bench is real. Suppressing by position alone rather than by
    // position AND kind would empty every station concourse.
    const markers = [marker("amenity=bench", 0, 0)];
    expect(suppressPoiInsideBuildings(markers, [square(40)])).toEqual(markers);
  });

  // OWED TO STAGE 1, and named rather than deleted so the record of what
  // containment has to get right survives the port. Both need a marker whose
  // kind IS building-scale, and none exists any more; stage 1's host resolver
  // needs the identical geometry test for a much wider set of markers and is
  // where they come back with real subjects.
  it.todo("keeps a host-scale node just OUTSIDE the footprint");
  it.todo(
    "does not confuse a bounding-box hit with containment (the L-shaped notch)",
  );

  it("is unchanged when there are no markers or no buildings", () => {
    expect(suppressPoiInsideBuildings([], [square(40)])).toEqual([]);
    const markers = [marker("amenity=cafe", 0, 0)];
    expect(suppressPoiInsideBuildings(markers, [])).toEqual(markers);
  });

  it("keeps marker order, which the pick table depends on", () => {
    // The consumer indexes identity by position in this array. Reordering it
    // would make every pick after the first name the wrong feature.
    const markers = [
      marker("amenity=bench", 0, 0),
      marker("amenity=cafe", 1, 1),
      marker("amenity=fountain", 2, 2),
    ];
    expect(suppressPoiInsideBuildings(markers, [square(40)])).toEqual(markers);
  });
});
