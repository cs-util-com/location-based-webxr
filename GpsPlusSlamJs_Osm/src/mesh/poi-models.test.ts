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
    //
    // TWO CEILINGS, BECAUSE THERE ARE TWO FAMILIES (DEC-S3) AND THEY HAVE
    // DIFFERENT COST PROFILES — not because the symbols would not fit under one.
    // The budget that matters is triangles times INSTANCES, and the two differ
    // there by a lot: family L is street furniture, which is what a city has
    // hundreds of (benches, bins, post boxes), while family S is places, of
    // which a view holds a handful (one pharmacy, two cafés). A denser symbol on
    // a rare kind costs less than a denser bench on a common one.
    //
    // Every family-S marker also pays a FIXED 120 triangles for the shared
    // column, which is 27 copies of one shape. DEC-S16 records the fix —
    // instancing one column for the whole city — and why it is not done yet: it
    // breaks the one-mesh-per-marker assumption in bucketing, `poiMarkerPosition`
    // and the pick table.
    const familyL = entries.filter((entry) => entry.symbol === undefined);
    const familyS = entries.filter((entry) => entry.symbol !== undefined);
    for (const entry of familyL) {
      expect(entry.mesh.triangleCount).toBeLessThan(400);
    }
    for (const entry of familyS) {
      expect(entry.mesh.triangleCount).toBeLessThan(1000);
    }
    // THE OUTLIER IS NAMED rather than absorbed by a loose bound, so it stays
    // visible: `leisure=garden` is ~910 because DEC-S10 COMBINED two symbols
    // into one at the owner's request — a flower bed with tools planted in it.
    // It is the only marker anywhere near the ceiling, and the first place to
    // look if the marker layer ever needs triangles back.
    const heaviest = familyS
      .slice()
      .sort((a, b) => b.mesh.triangleCount - a.mesh.triangleCount)[0];
    expect(heaviest?.kind).toBe("leisure=garden");
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
    // THE BENCH HAS CHANGED SOURCE TWICE, and the figures move with it. It came
    // from `poi-markers-gallery (2)`'s `k_bench` at 1.36 m long; batch C
    // replaced it with gallery C's reference re-drawing, which the owner
    // preferred (DEC-S14) and which is a 1.60 m bench with a taller back.
    //
    // IT STAYS FAMILY L, at real-world scale with no column and no envelope.
    // That is DEC-S3 holding its own line: a bench is the thing itself, and only
    // the kinds that are PLACES became symbols.
    //
    // `lo[Y]` is the assertion worth keeping across both sources. C's legs are
    // 0.45 m boxes centred at 0.22, so they reach 5 mm BELOW zero — invisible in
    // a gallery that draws them on a pad, half a centimetre of buried leg here.
    // `propFrom` grounds every port for exactly this reason.
    const { lo, hi } = boundsOf("amenity=bench");
    expect((hi[X] as number) - (lo[X] as number)).toBeCloseTo(1.6, 2);
    expect(hi[Y] as number).toBeGreaterThan(0.8);
    expect(hi[Y] as number).toBeLessThan(1.2);
    expect(lo[Y] as number).toBeCloseTo(0, 6);
    // A bench is much wider than it is deep, and deeper than it is thick. The
    // upper bound moved from 0.6 to 0.7 with the source change: C draws a
    // deeper seat with a raked back, which is 0.65 m front to back.
    const depth = (hi[Z] as number) - (lo[Z] as number);
    expect(depth).toBeGreaterThan(0.3);
    expect(depth).toBeLessThan(0.7);
    expect((hi[X] as number) - (lo[X] as number)).toBeGreaterThan(depth * 2);
  });

  it("paints the bench's metal frame apart from its timber", () => {
    // THE WHOLE REASON DEC-R6-15 CHOSE THIS PROTOTYPE. A bench is a wooden seat
    // in a metal frame, and until §4 our vocabulary could only say one colour
    // per model — so the frame and the slats were the same timber and the
    // detail the owner liked was not expressible at all.
    expect(poiModelFor("amenity=bench")?.mesh.colours).toBeDefined();
    expect(distinctColours("amenity=bench").size).toBeGreaterThanOrEqual(2);
  });

  it("builds `historic=wayside_cross` as a stepped, two-tone stone", () => {
    // Ported EXACTLY from `poi-markers-gallery (2)`'s `k_wayside_cross` — pure
    // boxes, no rotated parts, so nothing had to be approximated. Six boxes:
    // a two-step base, a pedestal, a shaft, a cross-arm and a capstone,
    // reaching 1.26 m.
    //
    // The old model was four boxes in one colour and 1.68 m tall, which reads
    // as a signpost rather than as a wayside cross. The cross-arm is what makes
    // it legible, and it has to be WIDER than the shaft to read at all.
    const { lo, hi } = boundsOf("historic=wayside_cross");
    expect(hi[Y] as number).toBeCloseTo(1.26, 2);
    expect(lo[Y] as number).toBeCloseTo(0, 6);
    // The arm spans 0.44 m against a 0.13 m shaft.
    expect((hi[X] as number) - (lo[X] as number)).toBeCloseTo(0.46, 2);
    expect(poiModelFor("historic=wayside_cross")?.mesh.triangleCount).toBe(
      6 * 12,
    );
    // Two stone tones, which is the detail one colour per model could not say.
    expect(distinctColours("historic=wayside_cross").size).toBe(2);
  });

  it("builds the second batch at the source's heights", () => {
    // Ported from `poi-markers-gallery (2)` with the plinth stripped and every
    // centre-y converted to a base-y. Heights are the source's own, so a
    // mistake in that conversion — the one transformation applied by hand —
    // shows up here rather than as a model that merely looks a bit off.
    for (const [kind, height] of [
      ["amenity=waste_basket", 0.9025],
      ["amenity=post_box", 1.045],
      ["historic=memorial", 1.12],
      ["amenity=drinking_water", 1.025],
    ] as const) {
      // Named in the object so a failure says WHICH kind drifted, rather than
      // reporting a bare number four models could have produced.
      expect({ kind, height: poiModelFor(kind)?.heightM }).toEqual({
        kind,
        height: expect.closeTo(height, 3),
      });
    }
  });

  it("tilts part of the information board, which is the point of it", () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT WAS WRONG. It took the minimum z over
    // all geometry in two y bands and required them to differ — on the theory
    // that "the board's front face must vary in z as it rises, which an
    // axis-aligned box cannot do".
    //
    // The adopted `D` model's board panel IS an axis-aligned box
    // (`poi-variants-d.ts`, `bx(0.66, 0.42, 0.07, …)`); only its ROOF is turned,
    // by `rotateX: -0.24`. The two bands sampled different parts — panel below,
    // panel-top AND the 2.3x deeper roof above — so the difference came from the
    // depth mismatch between two parts, not from any rotation. **Deleting the
    // rotation left it passing by a LARGER margin.** A test that names a
    // regression it cannot catch is worse than no test; found by review on
    // PR #250.
    //
    // WHAT IS ASSERTED NOW: that some face is genuinely turned. An axis-aligned
    // box only ever emits normals along ±x, ±y, ±z, so no face of one can have
    // BOTH a significant y and a significant z component. A box rotated about x
    // emits exactly that. This catches the deletion of `rotateX` directly, and
    // it does not care which part carries the tilt or how the model is scaled.
    const mesh = poiModelFor("tourism=information")?.mesh;
    if (mesh === undefined) throw new Error("no model");

    let turned = 0;
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const ny = Math.abs(mesh.normals[i + 1] as number);
      const nz = Math.abs(mesh.normals[i + 2] as number);
      // 0.1 on both axes: `rotateX: -0.24` gives |ny| ~ 0.97 and |nz| ~ 0.24,
      // so this clears it comfortably while no axis-aligned face can.
      if (ny > 0.1 && nz > 0.1) turned += 1;
    }
    expect(turned).toBeGreaterThan(0);
  });

  it("gives the bench slats rather than one solid slab", () => {
    // The slatting IS the detail. A single box of the same bounds passes every
    // other assertion here and looks like a plinth — which is what the model
    // before last effectively was (`slabOnLegs` plus one backrest box).
    //
    // COUNTED AS BOXES rather than pinned to one number, because the exact
    // count is a property of whichever source the bench currently comes from
    // and has already changed once. What must not change is that there are
    // MANY parts: C's version is three seat slats, three back slats and eight
    // frame pieces.
    const mesh = poiModelFor("amenity=bench")?.mesh;
    expect((mesh?.triangleCount ?? 0) / 12).toBeGreaterThanOrEqual(9);
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
