import { describe, expect, it } from "vitest";

import { CORPUS_SITES, type CorpusSite } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildBuildings, type BuildingVolume } from "../../mesh/buildings.js";

/**
 * WHY THESE TESTS MATTER (W3, DEC-R4-12). Round 3 shipped a fix for the
 * cathedral that was not the reported defect, and the reason it could is stated
 * in its own finding: _"the connection to what was seen on screen is a
 * hypothesis until a fixture test pins it."_ There was no such test, because
 * there was no data to write one against.
 *
 * These are the gate half of DEC-R4-12: **coarse geometry PROPERTIES**, not
 * pixels. A property survives a driver change, a headless-browser upgrade and a
 * palette tweak; a screenshot does not, and six sites multiply that fragility
 * rather than reduce it. The screenshot half exists too — the e2e suite writes
 * one image per site for a human to look at — but nothing asserts on it.
 *
 * The properties are chosen to catch the CLASS of defect that keeps appearing
 * here: geometry that is confidently wrong rather than absent. A footprint
 * silently reduced to its first ring, a part extruded from the wrong base, a
 * tower that comes out as a full-height prism — all of them produce a mesh that
 * renders happily and is wrong, and all of them violate at least one property
 * below.
 */

/** Every volume built for one site, once, because the build is the slow part. */
function volumesFor(site: CorpusSite): BuildingVolume[] {
  const extract = loadSite(site.id);
  const parsed = parseOverpassJson(extract.payload);
  return buildBuildings(parsed.features, {
    frame: enuFrameAt(site.position),
  });
}

const built = new Map<string, BuildingVolume[]>(
  CORPUS_SITES.map((site) => [site.id, volumesFor(site)]),
);

const cases = CORPUS_SITES.map((site) => [site.id, site] as const);

describe("site geometry", () => {
  it.each(cases)("%s builds at least one volume", (id) => {
    // The vacuous-green guard. Every other assertion here is universally
    // quantified over the volumes, so all of them pass trivially on an empty
    // build — which is exactly what a footprint-collection regression looks
    // like from the outside.
    expect(built.get(id)?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(cases)("%s produces no NaN vertex", (id) => {
    for (const volume of built.get(id) ?? []) {
      for (const value of volume.mesh.positions) {
        // NaN propagates into the transform and REMOVES the object from the
        // scene with nothing reported — a building that silently does not
        // exist, which reads as sparse OSM data rather than as a bug.
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it.each(cases)(
    "%s keeps every volume inside its captured tile",
    (id, site) => {
      const extract = loadSite(site.id);
      // Half-extent of the captured bbox in metres, plus a generous margin: a
      // building may legitimately straddle the tile edge, but not by kilometres.
      // A volume far outside is the signature of a frame or sign error, which is
      // the defect that once put a tree 100 m from its own building.
      const halfWidthM =
        ((extract.bbox.east - extract.bbox.west) / 2) *
        111_320 *
        Math.cos((site.position.lat * Math.PI) / 180);
      const halfHeightM =
        ((extract.bbox.north - extract.bbox.south) / 2) * 110_540;
      // TEN times the tile's half-extent, and the looseness is the honest
      // number rather than a weakened one. `out geom` returns WHOLE elements
      // that intersect the bbox, so a long way straddling the tile edge
      // legitimately reaches hundreds of metres beyond it — measured at 592 m
      // on a ~350 m Manhattan tile, which is a real building, not a bug.
      // What this still catches is the class it was written for: a frame origin
      // error, a degrees-for-metres mix-up or a missing projection, all of which
      // land geometry kilometres or millions of metres out rather than 1.7x.
      const limit = Math.max(halfWidthM, halfHeightM) * 10;

      for (const volume of built.get(id) ?? []) {
        const p = volume.mesh.positions;
        for (let i = 0; i < p.length; i += 3) {
          expect(Math.abs(p[i] as number)).toBeLessThan(limit);
          expect(Math.abs(p[i + 2] as number)).toBeLessThan(limit);
        }
      }
    },
  );

  it.each(cases)("%s builds no volume taller than the sanity ceiling", (id) => {
    // 830 m is the Burj Khalifa. Nothing in this corpus is close, so anything
    // above it is arithmetic rather than architecture — a metres/feet mix-up,
    // a level count read as a height, or a terrain base subtracted twice.
    for (const volume of built.get(id) ?? []) {
      const p = volume.mesh.positions;
      for (let i = 1; i < p.length; i += 3) {
        expect(p[i] as number).toBeLessThan(830);
      }
    }
  });

  it.each(cases)(
    "%s never extrudes a volume above its own tagged height",
    (id) => {
      // THE ASSERTION THIS ITEM EXISTS FOR. A tower that renders as a
      // full-height flat-topped prism instead of a spire is a volume whose
      // geometry reaches the height its ROOF was supposed to taper from. Stated
      // as "no vertex is above the resolved total height" it is checkable
      // without knowing what the right shape was.
      for (const volume of built.get(id) ?? []) {
        // A metre of slack: the roof generator and the height resolver work in
        // floats, and the vertical stretch applied for terrain rise is applied
        // to both, so exact equality is not the claim.
        const ceiling = volume.heights.totalHeightM + 1;
        const p = volume.mesh.positions;
        for (let i = 1; i < p.length; i += 3) {
          expect(p[i] as number).toBeLessThanOrEqual(
            ceiling + volume.mesh.positions.length * 0,
          );
        }
      }
    },
  );

  it("finds the cathedral's parts, which is why the site is in the corpus", () => {
    // R3-1/R4-7's precondition: if the extract does not contain the
    // `building:part` structure, no assertion about how it is drawn can mean
    // anything. This is the test that would have caught the round-3 fixture
    // being declined.
    const volumes = built.get("cologne-cathedral") ?? [];
    const parts = volumes.filter((v) => v.parentFeature !== undefined);
    expect(parts.length).toBeGreaterThan(10);
  });

  it("tapers a pyramidal roof to a point instead of a flat top", () => {
    // THE ASSERTION R4-7 IS ABOUT, and the one no synthetic fixture could make.
    // The reported defect is the cathedral's twin towers reading as tall
    // flat-topped PRISMS with a finer spire behind them, and a spire in OSM is
    // an upper `building:part` carrying `roof:shape=pyramidal`. A pyramidal roof
    // that came out flat-topped is a roof generator that fell back to the
    // approximation — visible, plausible, and completely silent.
    //
    // Stated as a property: the vertices at the very top of such a volume
    // collapse to ONE horizontal point. A prism has its whole footprint up
    // there; an apex has a single (x, z).
    const volumes = built.get("cologne-cathedral") ?? [];
    const pyramidal = volumes.filter(
      (v) => v.heights.roofShape === "pyramidal",
    );
    // The precondition: no pyramidal parts in the extract means this proves
    // nothing, and would do so silently.
    expect(pyramidal.length).toBeGreaterThan(0);

    for (const volume of pyramidal) {
      const p = volume.mesh.positions;
      let peak = -Infinity;
      for (let i = 1; i < p.length; i += 3)
        peak = Math.max(peak, p[i] as number);
      const atPeak = new Set<string>();
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs((p[i + 1] as number) - peak) > 0.01) continue;
        // Rounded to a centimetre: the apex is written once per triangle, so
        // exact float equality would count it many times over.
        atPeak.add(
          `${(p[i] as number).toFixed(2)},${(p[i + 2] as number).toFixed(2)}`,
        );
      }
      expect(atPeak.size).toBe(1);
    }
  });
});
