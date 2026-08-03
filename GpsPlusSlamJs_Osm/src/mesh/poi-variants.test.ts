import { describe, expect, it } from "vitest";

import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { POI_MODELS } from "./poi-models.js";
import { B_PALETTE } from "./poi-variants-b.js";
import { G_PALETTE } from "./poi-variants-g.js";
import { D_PALETTE, D_VARIANTS } from "./poi-variants-d.js";
import { P_PALETTE } from "./poi-variants-p.js";
import { M_PALETTE } from "./poi-variants-m.js";
import { markerHeightFor } from "./poi-variants.js";
import { L_PALETTE, L_VARIANTS } from "./poi-variants-l.js";
import { H_VARIANTS } from "./poi-variants-hybrid.js";
import {
  LIKED_VARIANTS,
  POI_VARIANTS,
  poiVariantsFor,
  scaledToHeight,
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

  it("builds every liked pair the owner named — all 51", () => {
    // NOW A GATE, AND IT WAS NOT ONE BEFORE. While the port ran source file by
    // source file this was a progress readout that could not fail, because a
    // red test for "not all 51 exist yet" would have been red for the whole job
    // and told nobody anything on the way. All six files are ported, so the
    // ratchet closes: from here, a pair that disappears is a REGRESSION, and a
    // pair silently dropped is exactly how §4.3's mapping would rot.
    const built = new Set(
      [...POI_VARIANTS.values()].flat().map((e) => `${e.kind}#${e.source}`),
    );
    const missing = LIKED_VARIANTS.filter(
      (v) => !built.has(`${v.kind}#${v.source}`),
    ).map((v) => `${v.kind}#${v.source}`);
    // ASSERT THE LIST, NOT THE COUNT, so a failure names the pairs.
    expect(missing).toEqual([]);
    // BOTH NUMBERS, because they are not the same: `built.size` counts every
    // variant in the registry, including the four ported from the house file
    // under DEC-R6-28 whose LIKED source is something else.
    console.log(
      `POI variants: ${LIKED_VARIANTS.length} of ${LIKED_VARIANTS.length} liked pairs built; ` +
        `${built.size} variants in the registry`,
    );
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
      H: 0,
    };
    for (const { source } of LIKED_VARIANTS) counts[source] += 1;
    // `H` IS ZERO HERE ON PURPOSE, and the zero is the point. `LIKED_VARIANTS`
    // records what the owner picked out of the six PROTOTYPES; a hybrid is
    // something they asked to be built afterwards, out of two of those picks.
    // Counting it here would inflate the totals above and break the one thing
    // this table is for — sending a later reader to the right source file.
    expect(counts).toEqual({ D: 18, G: 5, P: 4, L: 13, B: 7, M: 4, H: 0 });
  });
});

describe("the D port's palette agrees with the house one", () => {
  /**
   * WHY THE DUPLICATION IS ALLOWED, AND WHAT KEEPS IT HONEST. `poi-variants-d.ts`
   * re-declares the prototype's palette under the SOURCE's names (`woodMid`,
   * `metalDark`) rather than importing ours (`TIMBER`, `DARK_STEEL`), so a port
   * can be checked against the prototype line by line without translating every
   * colour in your head.
   *
   * That is a second copy of the same values, and a second copy drifts. This is
   * the assertion that stops it: the values a D model actually paints with must
   * be values the house palette contains. If someone re-tunes the house palette
   * and forgets this file, the variants would quietly stop matching the models
   * they are being compared against — and colour is the one thing DEC-R6-30
   * normalises specifically so it CANNOT confound the comparison.
   */
  it("paints ported variants only in colours their palettes declare", () => {
    // NOT "colours the shipped models use", which was the first version of this
    // and was wrong: D and the house-style file share ONE source palette, and D
    // legitimately reaches parts of it we have not adopted yet — `terracotta`,
    // `rust`, `wallDusty`, `foliageTeal`. Asserting against our subset flagged
    // ten of those as strays, which would have pushed the port towards
    // recolouring models to fit a palette that was never the constraint.
    //
    // What IS worth pinning is that no port invents a colour: every painted
    // value must be one this file declares, so a mistyped hex fails here rather
    // than shipping as a shade nobody chose.
    // `Math.fround` ON BOTH SIDES. Colours live in a `Float32Array`, so the
    // stored value is the float32 nearest to `hex / 255` — comparing it against
    // the float64 division fails for almost every colour, and the first version
    // of this test reported 20 strays that were all just rounding.
    const key = (r: number, g: number, b: number): string =>
      `${Math.fround(r)},${Math.fround(g)},${Math.fround(b)}`;
    const housePalette = new Set(
      [
        ...Object.values(D_PALETTE),
        ...Object.values(B_PALETTE),
        ...Object.values(G_PALETTE),
        ...Object.values(P_PALETTE),
        ...Object.values(M_PALETTE),
        ...Object.values(L_PALETTE),
      ].map((hex) =>
        key(
          ((hex >> 16) & 0xff) / 255,
          ((hex >> 8) & 0xff) / 255,
          (hex & 0xff) / 255,
        ),
      ),
    );

    const strays: string[] = [];
    for (const variant of [...POI_VARIANTS.values()].flat()) {
      if (!["D", "B", "G", "P", "M", "L"].includes(variant.source)) continue;
      const colours = variant.mesh.colours;
      if (colours === undefined) continue;
      for (let i = 0; i < colours.length; i += 3) {
        const seen = key(
          colours[i] as number,
          colours[i + 1] as number,
          colours[i + 2] as number,
        );
        // White is the unpainted identity, always legitimate.
        if (seen === "1,1,1" || housePalette.has(seen)) continue;
        if (!strays.includes(`${variant.kind}#${variant.source} ${seen}`)) {
          strays.push(`${variant.kind}#${variant.source} ${seen}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });
});

describe("scaledToHeight", () => {
  /**
   * WHY THIS EXISTS (DEC-V5). The `D` prototype is a DIORAMA: every kind fits a
   * common display envelope, with tiers at 0.35–0.7 m, 0.8–1.2 m and 1.35–1.9 m
   * "above the plinth" regardless of what the thing really is. Its
   * `place_of_worship` is ~1.9 m where the shipped one is 12 m.
   *
   * DEC-R6-8 keeps real-world scale, and §4 of this plan compares variants at
   * true size because that is part of what is being judged. Porting D's numbers
   * verbatim would put a 1.9 m church next to a 1.8 m human reference, which is
   * not a comparison of shapes — it is a comparison of one shape against a
   * mistake.
   *
   * So D's models are scaled UNIFORMLY to the height of the model already
   * shipped for that kind. Uniform is the whole point: it preserves every
   * proportion inside the model, which is exactly what the owner said they are
   * judging — _"I dont care about lighting or colors but the 3d models/shapes
   * ... look very different to each other"_.
   */
  it("scales a mesh uniformly to a target height", () => {
    const builder = new MeshBuilder();
    builder.vertex(1, 0, 0, 0, 1, 0);
    builder.vertex(0, 2, 0, 0, 1, 0);
    builder.vertex(0, 0, 1, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 6);
    // Height 2 -> 6, so every coordinate triples.
    expect(scaled.positions[0]).toBeCloseTo(3, 6);
    expect(scaled.positions[4]).toBeCloseTo(6, 6);
  });

  it("leaves NORMALS untouched, because a uniform scale does not turn them", () => {
    // A non-uniform scale would need the inverse transpose; a uniform one does
    // not change any direction. Scaling the normals as well would be a no-op at
    // best and a denormalisation at worst — and a denormalised normal shades
    // wrong without changing any silhouette, which is this round's recurring
    // class of invisible defect.
    const builder = new MeshBuilder();
    builder.vertex(0, 1, 0, 0.6, 0.8, 0);
    const scaled = scaledToHeight(builder.build(), 5);
    expect(scaled.normals[0]).toBeCloseTo(0.6, 6);
    expect(scaled.normals[1]).toBeCloseTo(0.8, 6);
  });

  it("keeps the base on the ground", () => {
    // The contract every model and variant is held to. Scaling about the origin
    // preserves a zero base; scaling about the centre would not, and would bury
    // or float every ported model by half its height.
    const builder = new MeshBuilder();
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(0, 3, 0, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 9);
    expect(scaled.positions[1]).toBeCloseTo(0, 6);
    expect(scaled.positions[4]).toBeCloseTo(9, 6);
  });

  it("returns the mesh unchanged when it has no height to scale", () => {
    // A flat model — a ground marking — has zero height, and dividing by it
    // would put Infinity into every position and remove the object from the
    // scene with nothing reported.
    const builder = new MeshBuilder();
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(1, 0, 1, 0, 1, 0);
    const mesh = builder.build();
    expect(scaledToHeight(mesh, 5)).toBe(mesh);
  });

  it("carries the colours through", () => {
    const builder = new MeshBuilder();
    builder.paint(0xff0000);
    builder.vertex(0, 0, 0, 0, 1, 0);
    builder.vertex(0, 1, 0, 0, 1, 0);
    const scaled = scaledToHeight(builder.build(), 2);
    expect(scaled.colours?.[0]).toBe(1);
  });
});

describe("poiVariantsFor", () => {
  it("returns an empty list for a kind with no liked alternative", () => {
    // Sixteen of the fifty are in no liked list. The gallery asks about every
    // kind it draws, so "none" has to be an ordinary answer rather than a throw.
    expect(poiVariantsFor("amenity=nonexistent")).toEqual([]);
  });
});

describe("DEC-V6 — the scale target, and the defect that produced it", () => {
  /**
   * WHY THIS SUITE EXISTS. DEC-V5 scaled every variant uniformly to the SHIPPED
   * model's height, on the reasoning that the shipped models are the ones with a
   * plausibility contract behind them, so taking the target from them makes a
   * variant real-scale by construction.
   *
   * **That reasoning has a hole, and the owner found it by looking.** It holds
   * only while the shipped model is an OBJECT. For an area kind the shipped
   * model is a ground MARKING — `amenity=parking` is a painted bay 0.12 m tall —
   * and its height is not "how tall this thing is". Scaling a 3 m sign post to
   * 0.12 m shrinks it by 25x. The owner's words were "Faktor 30, 40 kleiner",
   * and the same defect hit `swimming_pool`, `grave_yard` and `historic=yes`.
   *
   * Two of the 34 kinds could not be judged at all because of it, so this was
   * not a cosmetic bug — it cost a round of review.
   *
   * **The height assertion could never have caught this**, because the height is
   * correct by construction: the variant IS the target height. What is wrong is
   * that the target was the wrong lever. The FOOTPRINT is what exposes it.
   */
  const footprintOf = (mesh: MeshData): number => {
    let loX = Infinity;
    let hiX = -Infinity;
    let loZ = Infinity;
    let hiZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] as number;
      const z = mesh.positions[i + 2] as number;
      loX = Math.min(loX, x);
      hiX = Math.max(hiX, x);
      loZ = Math.min(loZ, z);
      hiZ = Math.max(hiZ, z);
    }
    return Math.max(hiX - loX, hiZ - loZ);
  };

  it("never scales a variant to a footprint absurdly unlike the shipped one", () => {
    // THE GUARD THAT WOULD HAVE CAUGHT IT. A variant and the shipped model are
    // the same real-world thing, so once scaled they should occupy comparable
    // ground. A factor of 8 is deliberately loose — a diorama vignette legibly
    // spreads wider than a single post, and this is a smell detector, not a
    // style rule. All four defects were 20x or worse.
    const strays: string[] = [];
    for (const [kind, list] of POI_VARIANTS) {
      const shipped = POI_MODELS.get(kind);
      if (shipped === undefined) continue;
      const base = footprintOf(shipped.mesh);
      for (const variant of list) {
        if (variant.mesh === shipped.mesh) continue;
        const ratio = footprintOf(variant.mesh) / base;
        if (ratio > 8 || ratio < 1 / 8) {
          strays.push(`${kind}#${variant.source} ${ratio.toFixed(2)}x`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("gives an area kind a marker height rather than its ground marking's", () => {
    // The four kinds whose shipped model is flat or low enough that its height
    // says nothing about the object a marker depicts. Pinned as VALUES because
    // each came from the owner naming the error — "ein Drittel so gross",
    // "mindestens dreimal so gross" — and a later reader should be able to see
    // that these are measured corrections rather than invented constants.
    expect(markerHeightFor("amenity=parking")).toBeGreaterThan(2);
    expect(markerHeightFor("leisure=swimming_pool")).toBeGreaterThan(0.8);
    expect(markerHeightFor("amenity=grave_yard")).toBeCloseTo(0.86 * 3, 5);
    expect(markerHeightFor("historic=yes")).toBeCloseTo(1.4 * 3, 5);
  });

  it("leaves every other kind on the shipped model's height", () => {
    // THE OVERRIDE MUST STAY SMALL. DEC-V5's reasoning is still right for the
    // 30 kinds where the shipped model is an object, and a table that grew to
    // cover every kind would be a second source of truth for how tall things
    // are — exactly what `heightM` being DERIVED was introduced to prevent.
    let overridden = 0;
    for (const [kind, model] of POI_MODELS) {
      if (markerHeightFor(kind) !== model.heightM) overridden += 1;
    }
    expect(overridden).toBe(4);
  });
});

describe("D's transform datum — one bug behind two of the owner's reports", () => {
  /**
   * WHAT WENT WRONG, and why it produced two unrelated-looking complaints.
   *
   * Every D coordinate is written in the SOURCE's frame, where the plinth top is
   * at `T = 0.10`, and `bx`/`cylD`/`coneD` strip that `T` as they emit. Six
   * places also needed a rotation, and each pushed a transform with the source's
   * absolute `y` — `{ rotateX: 0.6, y: T + 0.36 }` — while the part inside was
   * still emitted through `bx`, which stripped `T` again. **The transform's own
   * `T` was never stripped**, so every tilted part in the file sat exactly
   * `T = 0.10` too high.
   *
   * At D's diorama scale that is a sixth of a model, and the registry then
   * scales it up: on the playground, 0.10 becomes ~0.45 m in the world. The
   * owner reported it twice without any way to know it was one bug —
   * _"die Grabsteine fliegen in der Luft"_ and _"die Rutsche ist da zu hoch"_ —
   * and it also hit the information board's roof and the shelter's roof panels,
   * which nobody had reached yet.
   *
   * These tests run against the RAW `D_VARIANTS` build, before the registry
   * grounds and rescales, so the numbers are the source's own.
   *
   * **`z` IS NEGATED IN THE BUILT BUFFER.** `MeshBuilder.vertex` reflects ENU
   * onto the render frame, so a part written at `z = 0.1` is selected at
   * `z = -0.1` below.
   */
  // SEPARATE RADII, because a box's vertices sit at its CORNERS rather than at
  // its centre: selecting the headstone needs an x window wide enough to reach
  // its corners (0.088) while keeping z tight enough to exclude the footstone
  // sharing its centre (0.05 against the stone's 0.03).
  const columnYs = (
    mesh: MeshData,
    x: number,
    z: number,
    xRadius: number,
    zRadius: number,
  ): number[] => {
    const ys: number[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = (mesh.positions[i] as number) - x;
      const dz = (mesh.positions[i + 2] as number) - z;
      if (Math.abs(dx) <= xRadius && Math.abs(dz) <= zRadius) {
        ys.push(mesh.positions[i + 1] as number);
      }
    }
    return ys.sort((a, b) => a - b);
  };

  it("rests the graveyard's headstones on the grass rather than floating them", () => {
    // THE STONE IS ISOLATED BY ITS DEPTH. The footstone below it shares the same
    // x and z centre, so only the 0.06 depth (against the footstone's 0.10)
    // separates them — hence the tight z window, which keeps the footstone's
    // faces at |dz| = 0.05 out and the stone's at |dz| = 0.03 in.
    const build = D_VARIANTS.get("amenity=grave_yard");
    expect(build).toBeDefined();
    const ys = columnYs(build?.() as MeshData, -0.26, -0.1, 0.095, 0.031);
    expect(ys.length).toBeGreaterThan(0);
    // The grass plate tops out at 0.05, so that is where the stone's foot
    // belongs — give or take the few millimetres its lean drops one corner by.
    // With the bug it began at 0.15: the whole `T` in the air.
    expect(ys[0] as number).toBeGreaterThan(0.02);
    expect(ys[0] as number).toBeLessThan(0.09);
  });

  it("puts the playground's slide at the height its source asked for", () => {
    // The slide bed is the only mustard part, which selects it without guessing
    // at coordinates. It is symmetric about its own local origin, so however far
    // it is pitched, its MEAN y is exactly the transform's y — which makes the
    // mean the precise statement of "the datum is right", where the extremes
    // also move with the tilt and prove nothing on their own.
    const build = D_VARIANTS.get("leisure=playground");
    expect(build).toBeDefined();
    const mesh = build?.() as MeshData;
    const colours = mesh.colours;
    expect(colours).toBeDefined();
    const target = Math.fround(0xd9 / 255);
    let total = 0;
    let count = 0;
    for (let v = 0; v * 3 < mesh.positions.length; v++) {
      if (Math.fround(colours?.[v * 3] as number) !== target) continue;
      total += mesh.positions[v * 3 + 1] as number;
      count += 1;
    }
    expect(count).toBeGreaterThan(0);
    // The source says `y: T + 0.36`, which is 0.36 once `T` is stripped. The
    // bug stripped it nowhere and put the bed at 0.46 — and after the registry
    // scales the playground to 2.72 m that 0.10 becomes ~0.45 m in the world,
    // which is what the owner saw.
    expect(total / count).toBeCloseTo(0.36, 2);
  });
});

describe("L's hunting stand leans its ladder against the hut", () => {
  /**
   * THE OWNER'S REPORT: _"da müsste man allerdings die Leiter spiegeln, die ist
   * da irgendwie falsch rum, also die ist nicht an dem Häuschen dran"_ — the
   * ladder is turned the wrong way and does not touch the hut.
   *
   * They were right, and the sign is the whole of it. The source tilts the
   * ladder `rx: 0.22`, which in ENU sends its top toward `+z` — AWAY from the
   * hut it stands at `z = 0`. A ladder leaning the wrong way still reads as a
   * ladder from most angles, which is why it survived the port review.
   *
   * The assertion is a RELATION, not a coordinate: whatever the tilt and offset
   * end up being, the top must be nearer the hut than the base, and must reach
   * it. That survives someone re-tuning the lean later.
   */
  it("puts the ladder's top against the hut and its feet out on the ground", () => {
    const build = L_VARIANTS.get("amenity=hunting_stand");
    expect(build).toBeDefined();
    const mesh = build?.() as MeshData;
    const colours = mesh.colours;
    expect(colours).toBeDefined();

    // SELECTED BY X, NOT BY COLOUR ALONE. The hut's four legs and its roof are
    // woodDark too, and the legs run the ladder's whole height — a first version
    // of this test picked up a leg's foot and compared it against the ladder's
    // top. The ladder is the only woodDark part centred on x = 0: the legs sit
    // at x = ±0.13, the roof spans ±0.15, the rung is 0.14 wide.
    const dark = Math.fround(0x6b / 255);
    let top = { y: -Infinity, z: 0 };
    let bottom = { y: Infinity, z: 0 };
    for (let v = 0; v * 3 < mesh.positions.length; v++) {
      if (Math.fround(colours?.[v * 3] as number) !== dark) continue;
      if (Math.abs(mesh.positions[v * 3] as number) > 0.06) continue;
      const y = mesh.positions[v * 3 + 1] as number;
      const z = mesh.positions[v * 3 + 2] as number;
      if (y > top.y) top = { y, z };
      if (y < bottom.y) bottom = { y, z };
    }
    expect(top.y).toBeGreaterThan(bottom.y);

    // The hut is 0.22 deep about z = 0, so its near face is at z = -0.11 in the
    // built (render-frame) buffer. The ladder's top must reach it; its feet
    // must stand clear of it, which is what makes it a ladder rather than a
    // plank glued to a wall.
    expect(top.z).toBeGreaterThan(bottom.z);
    expect(top.z).toBeGreaterThan(-0.14);
    expect(bottom.z).toBeLessThan(-0.15);
  });
});

describe("the H hybrid — D's park with P's bench", () => {
  /**
   * THE OWNER'S ONE REQUEST FOR A COMBINATION: _"Bei dem Park ist die Variante D
   * am besten. Am besten die Variante D mit dem, mit der Bank von Variante P."_
   *
   * A hybrid is the easiest kind of model to get quietly wrong, because it looks
   * right if it is simply one parent: drop the bench and it is D's park, which
   * reads fine and is not what was asked for. These tests pin that BOTH parents
   * are present and that D's own bench is gone.
   */
  const park = (): MeshData => {
    const build = H_VARIANTS.get("leisure=park");
    if (build === undefined) throw new Error("no hybrid park");
    return build();
  };

  it("keeps D's ground — the grass plate is still 0.8 m across", () => {
    let widest = 0;
    const mesh = park();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      widest = Math.max(widest, Math.abs(mesh.positions[i] as number));
    }
    expect(widest).toBeCloseTo(0.4, 2);
  });

  it("carries a bench with two legs, which D's park did not have", () => {
    // D's bench is a plank plus a stub: no part of it descends to the grass.
    // P's stands on two legs from the grass up, so vertices at the plate top
    // (0.05) away from the plate's own rim are the signature of the graft.
    const mesh = park();
    let legVertices = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] as number;
      const y = mesh.positions[i + 1] as number;
      if (Math.abs(y - 0.05) > 1e-3) continue;
      if (Math.abs(x) > 0.39) continue; // the plate's own rim
      legVertices += 1;
    }
    expect(legVertices).toBeGreaterThanOrEqual(8); // two legs, four corners each
  });

  it("scales P's bench to D's park rather than dropping it in raw", () => {
    // THE TRAP THIS CATCHES. P's bench is 0.78 m long and D's park plate is
    // 0.80 m — a raw graft spans the whole park, and after the registry scales
    // the park to 4.56 m it is a five-metre bench. The seat must stay a
    // bench-sized fraction of the plate.
    const mesh = park();
    // The seat is the only woodMid part; the plate is wallSage and the trees
    // and legs woodDark.
    const colours = mesh.colours;
    expect(colours).toBeDefined();
    const woodMid = Math.fround(0x8a / 255);
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v * 3 < mesh.positions.length; v++) {
      if (Math.fround(colours?.[v * 3] as number) !== woodMid) continue;
      const x = mesh.positions[v * 3] as number;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    const seatLength = hi - lo;
    expect(seatLength).toBeGreaterThan(0.15);
    expect(seatLength).toBeLessThan(0.35);
  });
});
