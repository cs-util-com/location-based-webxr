import { describe, expect, it } from "vitest";

import { POI_MODELS } from "./poi-models.js";
import {
  LIKED_VARIANTS,
  POI_VARIANTS,
  poiVariantsFor,
  type VariantSource,
} from "./poi-variants.js";

/**
 * WHY THESE TESTS MATTER (DEC-R6-31).
 *
 * The owner looked at the fifty shipped models and said "I dont like most of
 * them", so the choice of model is being moved from a rule to a comparison —
 * every version they liked, rendered side by side at true size. That only works
 * if a variant is trustworthy enough to judge: a model that is inside out, half
 * buried or a hundred metres tall is not a fair candidate, it is a bug wearing
 * a candidate's clothes.
 *
 * **A variant is therefore held to exactly the contract a SHIPPED model is**,
 * because it is a candidate to become one. That is the whole reason these live
 * in the package rather than in the demo: this session found fifty models
 * rendering inside out for eighteen work items, invisible to every count-based
 * assertion and to the eye.
 *
 * The iteration form matters as much as the rules. A variant added without
 * satisfying the contract fails on registration, and nobody has to remember to
 * write its test.
 */
describe("the POI variant registry", () => {
  const entries = [...POI_VARIANTS.values()].flat();

  it("has at least one variant, so the suite below is not vacuous", () => {
    // The failure this catches is an empty registry passing every `for` loop
    // below in zero iterations and reporting a green suite for no coverage.
    expect(entries.length).toBeGreaterThan(0);
  });

  it("only offers variants for kinds that actually exist", () => {
    // A variant keyed on a kind outside `POI_MODELS` can never be compared
    // against the model it is meant to replace, and would render in the gallery
    // beside nothing.
    for (const kind of POI_VARIANTS.keys()) {
      expect({ kind, known: POI_MODELS.has(kind) }).toEqual({
        kind,
        known: true,
      });
    }
  });

  it("builds real geometry for every variant", () => {
    // The silent-absence guard. An empty mesh draws nothing, throws nothing and
    // counts as a variant — indistinguishable in the gallery from a kind that
    // simply has fewer versions.
    for (const entry of entries) {
      expect({
        id: `${entry.kind}#${entry.source}`,
        hasTriangles: entry.mesh.triangleCount > 0,
      }).toEqual({ id: `${entry.kind}#${entry.source}`, hasTriangles: true });
      expect(entry.mesh.indices.length).toBe(entry.mesh.triangleCount * 3);
    }
  });

  it("emits no NaN vertex or normal", () => {
    // NaN propagates into the instance transform and REMOVES the object from
    // the scene with nothing reported — so a variant with one would look like a
    // kind that has one fewer version rather than like a broken model.
    for (const entry of entries) {
      const bad = [...entry.mesh.positions, ...entry.mesh.normals].filter(
        (v) => !Number.isFinite(v),
      );
      expect({ id: `${entry.kind}#${entry.source}`, bad: bad.length }).toEqual({
        id: `${entry.kind}#${entry.source}`,
        bad: 0,
      });
    }
  });

  it("stands every variant ON the ground, not buried in it", () => {
    // The origin convention the gallery depends on: a variant is placed with a
    // translation alone, so its base has to be at y = 0. Half-buried reads as a
    // shorter model rather than as a bug — which would silently bias the
    // comparison this whole exercise exists to make fair.
    for (const entry of entries) {
      let lowest = Infinity;
      for (let i = 1; i < entry.mesh.positions.length; i += 3) {
        lowest = Math.min(lowest, entry.mesh.positions[i] as number);
      }
      expect({
        id: `${entry.kind}#${entry.source}`,
        lowest: Math.abs(lowest) < 1e-6,
      }).toEqual({ id: `${entry.kind}#${entry.source}`, lowest: true });
    }
  });

  it("reports a height that matches the geometry it built", () => {
    for (const entry of entries) {
      let peak = -Infinity;
      for (let i = 1; i < entry.mesh.positions.length; i += 3) {
        peak = Math.max(peak, entry.mesh.positions[i] as number);
      }
      expect(peak).toBeCloseTo(entry.heightM, 2);
    }
  });

  it("keeps every variant at a plausible real-world size", () => {
    // Variants are compared at TRUE SCALE (DEC-R6-8), which is part of what is
    // being judged: a model that only reads well at plinth scale is not one this
    // demo can use. So the same bounds apply as to a shipped model.
    for (const entry of entries) {
      expect({
        id: `${entry.kind}#${entry.source}`,
        plausible: entry.heightM > 0.05 && entry.heightM < 20,
      }).toEqual({ id: `${entry.kind}#${entry.source}`, plausible: true });
    }
  });

  it("winds every triangle to agree with its own normal", () => {
    // THE DEFECT THIS SESSION FOUND IN ALL FIFTY SHIPPED MODELS, applied to the
    // candidates before they can repeat it. With the POI material at FrontSide
    // and flatShading, three derives the shading normal from the winding — so an
    // inverted variant is drawn as its own far interior wall, at the same
    // silhouette, and would be judged in the gallery as though it were the model
    // its author intended.
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
        if (Math.hypot(wx, wy, wz) < 1e-9) continue;
        const nx = mesh.normals[ia * 3] as number;
        const ny = mesh.normals[ia * 3 + 1] as number;
        const nz = mesh.normals[ia * 3 + 2] as number;
        if (wx * nx + wy * ny + wz * nz <= 0) disagreeing.push(t);
      }
      expect({ id: `${entry.kind}#${entry.source}`, disagreeing }).toEqual({
        id: `${entry.kind}#${entry.source}`,
        disagreeing: [],
      });
    }
  });

  it("never lists the same source twice for one kind", () => {
    // Two variants with the same id are indistinguishable in the gallery and in
    // any decision recorded against it.
    for (const [kind, list] of POI_VARIANTS) {
      const sources = list.map((entry) => entry.source);
      expect({ kind, sources: [...new Set(sources)].length }).toEqual({
        kind,
        sources: sources.length,
      });
    }
  });
});

describe("LIKED_VARIANTS — the owner's notes as a checked-in table", () => {
  /**
   * WHY THE NOTES ARE A TABLE AND NOT A COMMENT. The mapping from kind to source
   * is the one thing a later reader cannot reconstruct from the code: once a
   * model is ported, nothing in the repo records which prototype it came from
   * or how many of them agreed on it. §4.3 of the round-6 plan wrote it out in
   * prose for exactly that reason; this makes it executable.
   */
  it("names 51 liked (kind, source) pairs across 34 kinds", () => {
    // The counts are from the owner's own notes and are asserted so that a pair
    // lost in transcription fails loudly. §4.3 checked the same totals against
    // the six note lines.
    expect(LIKED_VARIANTS.length).toBe(51);
    expect(new Set(LIKED_VARIANTS.map((v) => v.kind)).size).toBe(34);
  });

  it("only names kinds the registry models", () => {
    for (const { kind } of LIKED_VARIANTS) {
      expect({ kind, known: POI_MODELS.has(kind) }).toEqual({
        kind,
        known: true,
      });
    }
  });

  it("reports which liked pairs are not yet built, without failing", () => {
    // A PROGRESS READOUT RATHER THAN A GATE, deliberately. The port is done in
    // batches by source file, so a red test for "not all 51 exist yet" would be
    // red for the whole job and would tell nobody anything on the way. What
    // matters is that the remaining set is VISIBLE — a pair silently dropped is
    // how §4.3's mapping would rot.
    const built = new Set(
      [...POI_VARIANTS.values()].flat().map((e) => `${e.kind}#${e.source}`),
    );
    const missing = LIKED_VARIANTS.filter(
      (v) => !built.has(`${v.kind}#${v.source}`),
    ).map((v) => `${v.kind}#${v.source}`);
    console.log(
      `POI variants: ${built.size} of ${LIKED_VARIANTS.length} liked pairs built; ${missing.length} remaining`,
    );
    expect(missing.length).toBeLessThanOrEqual(LIKED_VARIANTS.length);
  });

  it("agrees with the per-source counts in the owner's notes", () => {
    // D 18, G 5, P 4, L 13, B 7, M 4 = 51. Checked because a pair attributed to
    // the wrong file would still total 51 and would send a later reader to the
    // wrong prototype.
    const counts: Record<VariantSource, number> = {
      D: 0,
      G: 0,
      P: 0,
      L: 0,
      B: 0,
      M: 0,
    };
    for (const { source } of LIKED_VARIANTS) counts[source] += 1;
    expect(counts).toEqual({ D: 18, G: 5, P: 4, L: 13, B: 7, M: 4 });
  });
});

describe("poiVariantsFor", () => {
  it("returns an empty list for a kind with no liked alternative", () => {
    // Sixteen of the fifty are in no liked list. The gallery asks about every
    // kind it draws, so "none" has to be an ordinary answer rather than a throw.
    expect(poiVariantsFor("amenity=nonexistent")).toEqual([]);
  });
});
