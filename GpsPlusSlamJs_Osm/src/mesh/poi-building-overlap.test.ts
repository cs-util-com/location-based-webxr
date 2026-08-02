/**
 * POI markers standing inside buildings that were already extruded — F33,
 * closed by §5 (DEC-R6-17).
 *
 * THE DEFECT. Four POI kinds are tall enough to be buildings in their own right
 * — `amenity=hospital` (15.3 m), `tourism=hotel` (13.5), `amenity=place_of_worship`
 * (12.0), `leisure=sports_centre` (9.0) — and a hospital is routinely mapped as
 * BOTH a node and a building way. `poi.ts` marks nodes, `buildings.ts` extrudes
 * ways, neither knows about the other, and the result is a 15 m block standing
 * inside a building that is already there.
 *
 * WHY IT LANDS HERE AND NOT IN §4. DEC-R6-8 kept POI models at real-world scale
 * rather than adopting the plinth idiom, which would have solved this for free
 * by making every marker ~0.9 m. So it is fixed as what it structurally IS — a
 * volume drawn where another volume already stands, which is the same defect §5
 * fixes for building outlines.
 *
 * THE ASSERTION THAT MATTERS MOST IS THE INVERSE ONE. A hospital mapped ONLY as
 * a node — no building way anywhere — must still draw. Suppressing that would
 * turn a visible fix into an invisible data loss, and it is the easy mistake:
 * the obvious implementation drops every tall POI and looks correct on the one
 * fixture where a building happens to exist.
 */

import { describe, expect, it } from "vitest";

import { poiModelFor } from "./poi-models.js";
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
  it("selects the four kinds that are buildings mapped as nodes", () => {
    // DERIVED FROM THE MODEL'S OWN HEIGHT, not from a hard-coded list of four
    // strings. A fifth tall model added later must be covered without anyone
    // remembering to update this — which is exactly what a literal list would
    // fail to do, silently.
    for (const kind of [
      "amenity=hospital",
      "tourism=hotel",
      "amenity=place_of_worship",
      "leisure=sports_centre",
    ]) {
      expect(poiModelFor(kind)).toBeDefined();
      expect(isBuildingScalePoi(kind)).toBe(true);
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
  it("drops a hospital node standing inside a building footprint", () => {
    // THE REPORTED DEFECT: a 15.3 m block inside a building that is already
    // extruded.
    const kept = suppressPoiInsideBuildings(
      [marker("amenity=hospital", 0, 0)],
      [square(40)],
    );
    expect(kept).toEqual([]);
  });

  it("KEEPS a hospital node with no building around it", () => {
    // THE ASSERTION THAT MATTERS MOST. A hospital mapped only as a node is the
    // case this must not break, and the obvious implementation — drop every
    // tall POI — looks correct on any fixture where a building happens to
    // exist.
    const markers = [marker("amenity=hospital", 0, 0)];
    expect(suppressPoiInsideBuildings(markers, [])).toEqual(markers);
    expect(suppressPoiInsideBuildings(markers, [square(40, 500, 500)])).toEqual(
      markers,
    );
  });

  it("keeps a BENCH inside a building, because it is not a duplicate", () => {
    // An atrium bench is real. Suppressing by position alone rather than by
    // position AND kind would empty every station concourse.
    const markers = [marker("amenity=bench", 0, 0)];
    expect(suppressPoiInsideBuildings(markers, [square(40)])).toEqual(markers);
  });

  it("keeps a hospital just OUTSIDE the footprint", () => {
    // The containment test has to be a real point-in-polygon rather than a
    // bounding-box hit, or a marker beside an L-shaped building disappears.
    const markers = [marker("amenity=hospital", 30, 30)];
    expect(suppressPoiInsideBuildings(markers, [square(40)])).toEqual(markers);
  });

  it("does not confuse a bounding-box hit with containment", () => {
    // An L-shape: the marker sits in the notch, inside the bbox and outside the
    // polygon. A bbox-only test would delete it.
    const lShape = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: -10 },
      { x: -10, y: -10 },
      { x: -10, y: 20 },
      { x: -20, y: 20 },
    ];
    const markers = [marker("amenity=hospital", 10, 10)];
    expect(suppressPoiInsideBuildings(markers, [lShape])).toEqual(markers);
  });

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
