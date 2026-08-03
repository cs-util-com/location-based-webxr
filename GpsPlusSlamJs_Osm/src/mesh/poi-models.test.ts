import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { POI_MODELS, poiModelFor } from "./poi-models.js";
import {
  POI_MODEL_LIMIT,
  parseUsageCount,
  rankPoiKinds,
} from "./poi-ranking.js";
import { POI_KEYS, poiKind } from "./poi.js";

/**
 * WHY THESE TESTS MATTER (W16–W19). Fifty models is fifty chances to ship a
 * shape that renders happily and is wrong — inside out, half-buried, a hundred
 * metres tall, or silently empty. None of those throw, and none of them are
 * visible at the six fixture sites unless that particular tag happens to be
 * mapped there, which for most of the fifty it is not (DEC-R4-14 accepted that
 * risk explicitly by declining a contact sheet).
 *
 * So the contract is enforced by ITERATION over the registry rather than by
 * fifty hand-written tests: a model added without satisfying it fails on
 * registration, and no one has to remember to write its test.
 *
 * The ranking gets the same treatment. It is committed rather than derived at
 * runtime — the sheet is publicly editable and the set of models that exist must
 * not depend on it — so something has to notice when the two drift.
 */
describe("the POI model registry", () => {
  const entries = [...POI_MODELS.values()];

  it("covers exactly the top fifty kinds the sheet ranks", () => {
    // THE ASSERTION THAT KEEPS THE TWO HALVES HONEST. A ranked kind with no
    // model is a marker that silently falls back to a cone; a model for a kind
    // outside the fifty is work spent on something the data says is rare.
    const ranked = rankPoiKinds(DEFAULT_RULE_TABLE_CSV, POI_MODEL_LIMIT);
    expect(ranked).toHaveLength(POI_MODEL_LIMIT);
    expect([...POI_MODELS.keys()].sort()).toEqual(
      ranked.map((entry) => entry.kind).sort(),
    );
  });

  it("only models kinds a POI marker can actually be placed for", () => {
    // `poi.ts` marks NODES carrying one of nine keys. A model for a `landuse` or
    // `building` value would never be drawn — those are ways and areas owned by
    // other builders — so it would be invisible work that looks like coverage.
    const eligible = new Set<string>(POI_KEYS);
    for (const entry of entries) {
      const key = entry.kind.slice(0, entry.kind.indexOf("="));
      expect(eligible.has(key)).toBe(true);
    }
  });

  it("agrees with `poiKind` about what a kind string looks like", () => {
    // The registry is keyed on the same string `poiKind` returns, so a marker
    // can look its model up directly. A different spelling here would make every
    // lookup miss while both sides looked correct in isolation.
    for (const entry of entries) {
      const [key, value] = entry.kind.split("=") as [string, string];
      expect(poiKind({ [key]: value })).toBe(entry.kind);
    }
  });

  it("builds real geometry for every kind", () => {
    // The silent-absence guard. An empty mesh draws nothing, throws nothing and
    // counts as a model — indistinguishable from a kind that is simply not
    // mapped nearby.
    for (const entry of entries) {
      expect(entry.mesh.triangleCount).toBeGreaterThan(0);
      expect(entry.mesh.positions.length).toBeGreaterThan(0);
      expect(entry.mesh.indices.length).toBe(entry.mesh.triangleCount * 3);
    }
  });

  it("emits no NaN vertex or normal", () => {
    // NaN propagates into the instance transform and REMOVES the object from
    // the scene with nothing reported — the same failure the site-geometry
    // corpus guards against for buildings. A degenerate cone cap is the likely
    // source, which is why `prism` skips the second triangle at zero radius.
    for (const entry of entries) {
      for (const value of entry.mesh.positions) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const value of entry.mesh.normals) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("stands every model ON the ground, not buried in it", () => {
    // The origin convention the consumer depends on: an instance is placed with
    // a translation alone, so the model's base has to be at y = 0. Half-buried
    // reads as a shorter object rather than as a bug — which is exactly how the
    // tree cones' half-height offset was found.
    for (const entry of entries) {
      let lowest = Infinity;
      for (let i = 1; i < entry.mesh.positions.length; i += 3) {
        lowest = Math.min(lowest, entry.mesh.positions[i] as number);
      }
      expect(lowest).toBeCloseTo(0, 6);
    }
  });

  it("reports a height that matches the geometry it built", () => {
    // `heightM` is what a consumer sizes a label or a fallback from. A stated
    // height that disagreed with the mesh would be a second source of truth for
    // how tall the thing is.
    for (const entry of entries) {
      let peak = -Infinity;
      for (let i = 1; i < entry.mesh.positions.length; i += 3) {
        peak = Math.max(peak, entry.mesh.positions[i] as number);
      }
      expect(peak).toBeCloseTo(entry.heightM, 2);
    }
  });

  it("keeps every model at a plausible real-world size", () => {
    // Scale is most of what makes a bench read as a bench, and the failure this
    // catches is a decimal point: a 20 m waste basket or a 5 cm hospital.
    for (const entry of entries) {
      expect(entry.heightM).toBeGreaterThan(0.05);
      expect(entry.heightM).toBeLessThan(20);
      let extent = 0;
      for (let i = 0; i < entry.mesh.positions.length; i += 3) {
        extent = Math.max(
          extent,
          Math.abs(entry.mesh.positions[i] as number),
          Math.abs(entry.mesh.positions[i + 2] as number),
        );
      }
      expect(extent).toBeLessThan(30);
    }
  });

  it("winds every triangle of every model to agree with its own normal", () => {
    // THE GUARD THAT WAS MISSING FOR ALL OF W16–§4, and its absence cost every
    // marker in the demo. `box` and `prism` emitted every face wound against
    // its own normal, so with the POI material at `FrontSide` — three's default,
    // and nothing overrides it for markers — what was drawn was each object's
    // far INTERIOR wall rather than its near face.
    //
    // WHY NOTHING CAUGHT IT. The silhouette is identical, lighting comes from
    // the assigned normals so it still looks lit, and a bench still reads as a
    // bench. `mesh-orientation.test.ts` pins exactly this property, but only for
    // `extrude.ts` and `roof.ts` — the two emitters already caught getting it
    // wrong once. Everything asserted here was count, bounds or finiteness, and
    // a reversed winding disturbs none of them.
    //
    // AT THE REGISTRY RATHER THAN THE PRIMITIVE, deliberately, and in addition
    // to the per-primitive suite: `hut`, `canopy`, `slabOnLegs` and
    // `postWithHead` compose the others and emit their own gable triangles, and
    // a model can also emit geometry inline. This covers whatever a model
    // actually built, which is the thing that ships.
    for (const entry of entries) {
      const mesh = entry.mesh;
      const disagreeing: number[] = [];
      for (let t = 0; t * 3 < mesh.indices.length; t++) {
        const ia = mesh.indices[t * 3] as number;
        const ib = mesh.indices[t * 3 + 1] as number;
        const ic = mesh.indices[t * 3 + 2] as number;
        const at = (i: number, o: number): number =>
          mesh.positions[i * 3 + o] as number;
        const ux = at(ib, 0) - at(ia, 0);
        const uy = at(ib, 1) - at(ia, 1);
        const uz = at(ib, 2) - at(ia, 2);
        const vx = at(ic, 0) - at(ia, 0);
        const vy = at(ic, 1) - at(ia, 1);
        const vz = at(ic, 2) - at(ia, 2);
        const wx = uy * vz - uz * vy;
        const wy = uz * vx - ux * vz;
        const wz = ux * vy - uy * vx;
        // A degenerate sliver carries no orientation, so it cannot be judged.
        if (Math.hypot(wx, wy, wz) < 1e-9) continue;
        const nx = mesh.normals[ia * 3] as number;
        const ny = mesh.normals[ia * 3 + 1] as number;
        const nz = mesh.normals[ia * 3 + 2] as number;
        if (wx * nx + wy * ny + wz * nz <= 0) disagreeing.push(t);
      }
      expect({ kind: entry.kind, disagreeing }).toEqual({
        kind: entry.kind,
        disagreeing: [],
      });
    }
  });

  it("keeps any per-face painting aligned to the geometry it paints", () => {
    // §4's per-face painting is being introduced model by model, so at any
    // moment some entries carry a colour buffer and some do not. Both are
    // valid; a buffer that does not match its positions is not.
    //
    // WHY THIS IS AN ITERATION TEST RATHER THAN A PER-MODEL ONE. A misaligned
    // colour array paints the WRONG faces — it does not throw, does not change
    // the silhouette, and looks exactly like the model was authored that way.
    // Nobody reviewing a new model would catch it by reading the composition.
    for (const entry of entries) {
      const colours = entry.mesh.colours;
      if (colours === undefined) continue;
      expect(colours.length).toBe(entry.mesh.positions.length);
      for (const value of colours) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stays low-polygon, which is the house style and the AR budget", () => {
    // A marker is a few metres of screen space in AR. The ceiling is generous
    // enough for a church with a spire and tight enough that nobody quietly
    // subdivides a cylinder to 64 sides.
    for (const entry of entries) {
      expect(entry.mesh.triangleCount).toBeLessThan(400);
    }
  });

  it("resolves a kind to its model, and an unmodelled one to undefined", () => {
    expect(poiModelFor("amenity=bench")?.kind).toBe("amenity=bench");
    // `undefined` rather than a throw: the fallback pin is a real answer for the
    // long tail, and 700 sheet rows minus 50 is a lot of tail.
    expect(poiModelFor("amenity=nonexistent")).toBeUndefined();
  });

  it("models the two kinds the feedback named by hand", () => {
    // The notes asked for "die Bench oder sowas, die Parkbank, der Mülleimer"
    // specifically. They rank 3rd and 13th, so the data agreed — but if a
    // re-ranked sheet ever dropped them, that would be worth noticing rather
    // than absorbing silently.
    expect(poiModelFor("amenity=bench")).toBeDefined();
    expect(poiModelFor("amenity=waste_basket")).toBeDefined();
  });
});

describe("the §4 rebuilt models", () => {
  /**
   * WHY THESE ARE PINNED INDIVIDUALLY when the registry contract already
   * iterates everything. The contract tests catch a model that is broken —
   * empty, buried, inside out, absurdly sized. They cannot catch a model that
   * is merely WRONG: a bench with no backrest is a perfectly valid mesh of a
   * plausible size sitting correctly on the ground.
   *
   * So each rebuilt kind gets a few assertions about the thing it is supposed
   * to be, drawn from the source prototype's own dimensions. These are also the
   * only place the port is checked against its source at all — §4.3's mapping
   * says which prototype each kind came from, but nothing else compares the
   * result to it.
   */
  /** Per-axis `[x, y, z]` extents of a kind's mesh, in metres. */
  const boundsOf = (kind: string): { lo: number[]; hi: number[] } => {
    const mesh = poiModelFor(kind)?.mesh;
    if (mesh === undefined) throw new Error(`no model for ${kind}`);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i++) {
      const axis = i % 3;
      const value = mesh.positions[i] as number;
      lo[axis] = Math.min(lo[axis] as number, value);
      hi[axis] = Math.max(hi[axis] as number, value);
    }
    return { lo, hi };
  };
  const [X, Y, Z] = [0, 1, 2];

  /** The distinct RGB triples a kind's mesh is painted with. */
  const distinctColours = (kind: string): Set<string> => {
    const colours = poiModelFor(kind)?.mesh.colours;
    const seen = new Set<string>();
    if (colours === undefined) return seen;
    for (let i = 0; i < colours.length; i += 3) {
      seen.add(`${colours[i]},${colours[i + 1]},${colours[i + 2]}`);
    }
    return seen;
  };

  it("builds `amenity=bench` at the source's real dimensions", () => {
    // THE MODEL THE OWNER RATED BEST — "nice details, best version so far" —
    // and the one §4.3 names as the model to study first, since it is the one
    // already judged best in the vocabulary being adopted.
    //
    // Dimensions come from `poi-markers-gallery (2)`'s `k_bench`, with the
    // plinth tier stripped per DEC-R6-15 and DEC-R6-8's real-world scale: 1.36 m
    // of slat, a seat surface at ~0.465 m, a backrest reaching ~0.775 m.
    const { lo, hi } = boundsOf("amenity=bench");
    expect((hi[X] as number) - (lo[X] as number)).toBeCloseTo(1.36, 2);
    expect(hi[Y] as number).toBeCloseTo(0.775, 2);
    expect(lo[Y] as number).toBeCloseTo(0, 6);
    // A bench is much wider than it is deep, and deeper than it is thick.
    const depth = (hi[Z] as number) - (lo[Z] as number);
    expect(depth).toBeGreaterThan(0.3);
    expect(depth).toBeLessThan(0.6);
  });

  it("paints the bench's metal frame apart from its timber", () => {
    // THE WHOLE REASON DEC-R6-15 CHOSE THIS PROTOTYPE. A bench is a wooden seat
    // in a metal frame, and until §4 our vocabulary could only say one colour
    // per model — so the frame and the slats were the same timber and the
    // detail the owner liked was not expressible at all.
    expect(poiModelFor("amenity=bench")?.mesh.colours).toBeDefined();
    expect(distinctColours("amenity=bench").size).toBeGreaterThanOrEqual(2);
  });

  it("gives the bench slats rather than one solid slab", () => {
    // The slatting IS the detail. A single box of the same bounds passes every
    // other assertion here and looks like a plinth — which is what the previous
    // model effectively was (`slabOnLegs` plus one backrest box).
    const mesh = poiModelFor("amenity=bench")?.mesh;
    // Three seat slats, two back slats, four frame pieces: nine boxes at 12
    // triangles each.
    expect(mesh?.triangleCount).toBe(9 * 12);
  });
});

describe("parseUsageCount", () => {
  it("reads the space-grouped number and ignores the percentage", () => {
    // The live sheet writes `"6 109 792\n30.12%"`. `Number` gives NaN, which
    // would rank everything equally; reading the second line as digits would
    // rank a rare tag at "3012".
    expect(parseUsageCount("6 109 792\n30.12%")).toBe(6109792);
    expect(parseUsageCount("1234")).toBe(1234);
  });

  it("returns undefined for anything that is not a count", () => {
    expect(parseUsageCount(undefined)).toBeUndefined();
    expect(parseUsageCount("")).toBeUndefined();
    expect(parseUsageCount("lots")).toBeUndefined();
  });
});

describe("rankPoiKinds", () => {
  it("orders by count, most common first", () => {
    const ranked = rankPoiKinds(DEFAULT_RULE_TABLE_CSV, POI_MODEL_LIMIT);
    for (let i = 1; i < ranked.length; i++) {
      expect((ranked[i - 1] as { count: number }).count).toBeGreaterThanOrEqual(
        (ranked[i] as { count: number }).count,
      );
    }
  });

  it("is stable, so the committed list does not drift between runs", () => {
    // Ties break on the kind string. Without that, two tags with equal counts
    // would swap places between runs and the committed list would look like it
    // had been edited when nothing had changed.
    const a = rankPoiKinds(DEFAULT_RULE_TABLE_CSV, POI_MODEL_LIMIT);
    const b = rankPoiKinds(DEFAULT_RULE_TABLE_CSV, POI_MODEL_LIMIT);
    expect(a.map((entry) => entry.kind)).toEqual(b.map((entry) => entry.kind));
  });
});
