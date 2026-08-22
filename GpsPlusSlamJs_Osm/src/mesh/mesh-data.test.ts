import { describe, expect, it } from "vitest";

import { MeshBuilder } from "./mesh-data.js";

/**
 * WHY THESE TESTS MATTER (§4, DEC-R6-11/R6-15). Per-face painting is the
 * capability our primitive vocabulary most lacks — it is how the prototypes get
 * a bench with a different-coloured seat from one box — and it is being added to
 * a builder that every other mesh in the package already runs through.
 *
 * So the risk is not "does painting work". It is **"does adding painting change
 * anything for the meshes that do not use it"**: buildings, roads, plates and
 * region slabs all build through `MeshBuilder` on the hot path, and a colour
 * array allocated for each of them would be pure waste that nothing reports.
 *
 * The other half is the alignment trap. Colours are a THIRD parallel array over
 * the same vertices, and `append` splices two meshes together — so a mesh with
 * colours appended to one without (or the reverse) is exactly where the arrays
 * can silently desynchronise. A misaligned colour buffer does not throw; it
 * paints the wrong faces, which looks like a modelling mistake rather than a
 * buffer bug.
 */
describe("MeshBuilder transforms", () => {
  /**
   * WHY THIS EXISTS (§4, DEC-R6-26). The house style places parts with a full
   * transform — `Parts.push` composes a `Matrix4` from position AND rotation —
   * and 13 of its 52 builders use one. The tilts are structural rather than
   * decorative: an information board that is not tilted is a fence panel, and a
   * viewpoint telescope at 31 degrees becomes a pipe lying on a post.
   *
   * THE RISK IS NOT ROTATION, IT IS THE MESHES THAT DO NOT USE IT. Buildings,
   * roads, plates and slabs all run through this builder, so the identity case
   * must be a genuine no-op — not "close enough after a matrix multiply". A
   * silent 1e-16 drift in every building vertex is the kind of change that
   * shows up as a failing pixel assertion three rounds later.
   *
   * The other half is NORMALS. A rotated part whose normals were not rotated
   * with it is lit as though it were still axis-aligned — the same class of
   * silent wrongness as the winding inversion §4 just fixed, and invisible in
   * every count-based assertion.
   */
  const cube = (builder: MeshBuilder): void => {
    const a = builder.vertex(0, 0, 1, 0, 0, 1);
    const b = builder.vertex(1, 0, 1, 0, 0, 1);
    const c = builder.vertex(1, 1, 1, 0, 0, 1);
    builder.triangle(a, b, c);
  };

  it("is a bit-exact no-op when nothing is rotated", () => {
    // THE GUARD THAT MATTERS MOST. Every mesh in the package that is not a POI
    // model goes through here untransformed, and "almost identical" is not good
    // enough for a buffer that pixel assertions are compared against.
    const plain = new MeshBuilder();
    cube(plain);
    const transformed = new MeshBuilder();
    transformed.pushTransform({});
    cube(transformed);
    transformed.popTransform();
    expect([...transformed.build().positions]).toEqual([
      ...plain.build().positions,
    ]);
    expect([...transformed.build().normals]).toEqual([
      ...plain.build().normals,
    ]);
  });

  it("rotates positions about X by the RIGHT-HANDED angle given", () => {
    // THE HANDEDNESS IS PINNED HERE ON PURPOSE, and the first version of this
    // test had it backwards. A right-handed quarter turn about +X sends
    // `y' = y cos - z sin`, `z' = y sin + z cos`, so ENU +z (north) goes to
    // **-y**, not +y. That is three's convention and therefore what the source
    // prototype's `rx` values mean — porting them against the opposite sign
    // would tilt every board the wrong way, which reads as a modelling choice
    // rather than as an error.
    //
    // Checked in the BUILT buffer, so it includes the builder's own ENU->render
    // reflection; asserting on the input would prove nothing about what ships.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateX: Math.PI / 2 });
    builder.vertex(0, 0, 1, 0, 0, 1);
    builder.popTransform();
    const mesh = builder.build();
    expect(mesh.positions[0]).toBeCloseTo(0, 6);
    expect(mesh.positions[1]).toBeCloseTo(-1, 6);
    expect(mesh.positions[2]).toBeCloseTo(0, 6);
  });

  it("rotates NORMALS with the positions, not just the geometry", () => {
    // The silent half. A tilted board whose normals stayed axis-aligned is lit
    // as though it were upright — geometry right, picture wrong, and no
    // count-based assertion can see it.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateX: Math.PI / 2 });
    builder.vertex(0, 0, 0, 0, 0, 1);
    builder.popTransform();
    const mesh = builder.build();
    expect(mesh.normals[0]).toBeCloseTo(0, 6);
    expect(mesh.normals[1]).toBeCloseTo(-1, 6);
    expect(mesh.normals[2]).toBeCloseTo(0, 6);
  });

  it("rotates about Z, which the leaning-headstone case needs", () => {
    // ADDED FOR THE `D` PORT. Its `grave_yard` tilts each headstone a few
    // degrees about Z (`rz: 0.05`, `-0.04`) and that lean IS the model — a
    // graveyard of perfectly upright stones reads as a car park. The stack had
    // X and Y only, so this was the first source detail our vocabulary could
    // not express at all.
    //
    // Right-handed like the others: a quarter turn about +x sends +y to −x.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateZ: Math.PI / 2 });
    builder.vertex(0, 1, 0, 0, 1, 0);
    builder.popTransform();
    const mesh = builder.build();
    expect(mesh.positions[0]).toBeCloseTo(-1, 6);
    expect(mesh.positions[1]).toBeCloseTo(0, 6);
    expect(mesh.normals[0]).toBeCloseTo(-1, 6);
  });

  it("keeps a rotated normal unit length", () => {
    // A rotation preserves length by definition, so a non-unit result means the
    // maths is wrong rather than the input. Cheap, and it pins the whole
    // arithmetic rather than one axis of it.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateX: 0.37, rotateY: -1.1 });
    builder.vertex(0, 0, 0, 0.6, 0.8, 0);
    builder.popTransform();
    const mesh = builder.build();
    const [nx = 0, ny = 0, nz = 0] = mesh.normals;
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
  });

  it("restores the previous transform on pop, so parts do not accumulate", () => {
    // A model tilts one part and then carries on with the rest. If `pop` did
    // not restore, every part after the first tilted one would inherit the
    // tilt — which looks like a modelling mistake in the parts that follow
    // rather than a bug in the builder.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateX: Math.PI / 2 });
    builder.vertex(0, 0, 1, 0, 0, 1);
    builder.popTransform();
    builder.vertex(0, 0, 1, 0, 0, 1);
    const mesh = builder.build();
    // The second vertex is untouched: ENU +z stored as render -z.
    expect(mesh.positions[3]).toBeCloseTo(0, 6);
    expect(mesh.positions[4]).toBeCloseTo(0, 6);
    expect(mesh.positions[5]).toBeCloseTo(-1, 6);
  });

  it("offsets a rotated part so it can be placed as well as tilted", () => {
    // The source composes position AND rotation in one matrix, and the order is
    // rotate-then-translate. Applying them the other way round swings a part
    // around the model origin instead of its own, which puts a tilted board a
    // metre from where the source has it.
    const builder = new MeshBuilder();
    builder.pushTransform({ rotateX: Math.PI / 2, y: 2 });
    builder.vertex(0, 0, 1, 0, 0, 1);
    builder.popTransform();
    const mesh = builder.build();
    // Rotate first: ENU +z -> -y. Then offset: -1 + 2 = 1. Translating BEFORE
    // rotating would give -2 instead, swinging the part around the model origin.
    expect(mesh.positions[1]).toBeCloseTo(1, 6);
  });
});

describe("MeshBuilder colours", () => {
  const triangle = (builder: MeshBuilder): void => {
    const a = builder.vertex(0, 0, 0, 0, 1, 0);
    const b = builder.vertex(1, 0, 0, 0, 1, 0);
    const c = builder.vertex(0, 0, 1, 0, 1, 0);
    builder.triangle(a, b, c);
  };

  it("emits NO colour array when nothing was painted", () => {
    // THE COST GUARD, and the reason it is the first test. Every building,
    // road, plate and slab in the package builds through here. If an unpainted
    // mesh grew a colour buffer, that is one more Float32Array the size of the
    // positions on the chunk-meshing hot path, allocated and transferred for
    // nothing — and no test or gate would have reported it.
    const builder = new MeshBuilder();
    triangle(builder);
    expect(builder.build().colours).toBeUndefined();
  });

  it("emits one RGB triple per vertex once anything is painted", () => {
    const builder = new MeshBuilder();
    builder.paint(0xff0000);
    triangle(builder);
    const mesh = builder.build();
    expect(mesh.colours).toBeDefined();
    expect(mesh.colours?.length).toBe(mesh.positions.length);
  });

  it("paints faces independently, so one box can have two coloured sides", () => {
    // THE CAPABILITY ITSELF. `poi-markers-gallery (2)`'s models get their detail
    // from painting individual faces of one box — a bench seat against its
    // frame, a sign panel against its post — which our vocabulary could not
    // express at all before this.
    const builder = new MeshBuilder();
    builder.paint(0xff0000);
    triangle(builder);
    builder.paint(0x0000ff);
    triangle(builder);
    const colours = builder.build().colours;
    expect(colours).toBeDefined();
    const distinct = new Set<string>();
    for (let i = 0; i < (colours?.length ?? 0); i += 3) {
      distinct.add(`${colours?.[i]},${colours?.[i + 1]},${colours?.[i + 2]}`);
    }
    expect(distinct.size).toBe(2);
    expect(distinct.has("1,0,0")).toBe(true);
    expect(distinct.has("0,0,1")).toBe(true);
  });

  it("leaves UNPAINTED vertices white, which is the model's own colour", () => {
    // WHY WHITE AND NOT BLACK, and this is the whole reason partial painting is
    // safe. `vertexColors` MULTIPLIES the material colour, so white is the
    // identity: an unpainted vertex renders as `PoiModel.colour`, exactly as it
    // did before this existed. Black would render every unpainted face as a
    // silhouette, and the failure would look like a lighting bug.
    const builder = new MeshBuilder();
    triangle(builder);
    builder.paint(0xff0000);
    triangle(builder);
    const colours = builder.build().colours;
    expect([colours?.[0], colours?.[1], colours?.[2]]).toEqual([1, 1, 1]);
    expect([colours?.[9], colours?.[10], colours?.[11]]).toEqual([1, 0, 0]);
  });

  it("keeps colours aligned when a painted mesh is appended to an unpainted one", () => {
    // THE ALIGNMENT TRAP, in the direction that needs a backfill: the target has
    // three uncoloured vertices already, so the appended mesh's colours must
    // land at index 9 and not at index 0.
    const painted = new MeshBuilder();
    painted.paint(0x00ff00);
    triangle(painted);

    const target = new MeshBuilder();
    triangle(target);
    target.append(painted.build());
    const mesh = target.build();

    expect(mesh.colours?.length).toBe(mesh.positions.length);
    expect([mesh.colours?.[0], mesh.colours?.[1], mesh.colours?.[2]]).toEqual([
      1, 1, 1,
    ]);
    expect([mesh.colours?.[9], mesh.colours?.[10], mesh.colours?.[11]]).toEqual(
      [0, 1, 0],
    );
  });

  it("keeps colours aligned when an unpainted mesh is appended to a painted one", () => {
    // THE OTHER DIRECTION, which is the one a naive implementation gets wrong:
    // the appended mesh contributes no colours at all, so without a white
    // backfill the array ends up SHORTER than the positions and every colour
    // after the join reads the wrong vertex.
    const plain = new MeshBuilder();
    triangle(plain);

    const target = new MeshBuilder();
    target.paint(0x00ff00);
    triangle(target);
    target.append(plain.build());
    const mesh = target.build();

    expect(mesh.colours?.length).toBe(mesh.positions.length);
    expect([mesh.colours?.[0], mesh.colours?.[1], mesh.colours?.[2]]).toEqual([
      0, 1, 0,
    ]);
    expect([mesh.colours?.[9], mesh.colours?.[10], mesh.colours?.[11]]).toEqual(
      [1, 1, 1],
    );
  });

  it("stays unpainted when an unpainted mesh is appended to an unpainted one", () => {
    // The cost guard again, across `append` — `extrude.ts` and `chunk-meshes.ts`
    // both build entirely by appending, so if append alone were enough to
    // trigger allocation the first guard would pass while every real mesh in
    // the package still paid.
    const plain = new MeshBuilder();
    triangle(plain);
    const target = new MeshBuilder();
    triangle(target);
    target.append(plain.build());
    expect(target.build().colours).toBeUndefined();
  });

  it("decodes the packed hex the model palette is written in", () => {
    // The palette in `poi-models.ts` is `0xrrggbb` integers, so the builder has
    // to take that form rather than a float triple — otherwise every model
    // would carry its own conversion and one of them would get the channel
    // order wrong.
    const builder = new MeshBuilder();
    builder.paint(0x336699);
    triangle(builder);
    const colours = builder.build().colours;
    expect(colours?.[0]).toBeCloseTo(0x33 / 255, 6);
    expect(colours?.[1]).toBeCloseTo(0x66 / 255, 6);
    expect(colours?.[2]).toBeCloseTo(0x99 / 255, 6);
  });
});

/**
 * WHY THESE TESTS MATTER (2026-08-22 perf loop, OSM iteration 10). The builder's
 * accumulators became growable typed arrays doubled in place, replacing
 * `number[]` with `push`. That removed the largest single cost in the demo's
 * mesh build — but it introduced a failure mode the old design could not have:
 * a buffer whose written prefix and whose capacity disagree.
 *
 * Every case below crosses at least one growth boundary (`INITIAL_CAPACITY` is
 * 96 floats, i.e. 32 vertices), which is the ONLY place the new arithmetic can
 * be wrong. A misplaced `slice` bound would hand back spare capacity as real
 * vertices — trailing zeroes that render as geometry collapsed to the origin,
 * and that no existing test would see, because every existing test builds
 * meshes far below the first growth step.
 */
describe("MeshBuilder buffer growth", () => {
  /** `count` distinct vertices, each carrying its own index as its x. */
  function ramp(builder: MeshBuilder, count: number): void {
    for (let i = 0; i < count; i++) builder.vertex(i, 0, 0, 0, 1, 0);
  }

  it("returns exactly the vertices written, not the capacity reserved", () => {
    // 100 vertices is past the 32-vertex initial capacity and NOT a power of
    // two, so the buffer is over-allocated when `build` runs — which is the
    // whole point: the slice bound has to be the write cursor, not the length.
    const builder = new MeshBuilder();
    ramp(builder, 100);
    const mesh = builder.build();
    expect(mesh.positions).toHaveLength(300);
    expect(mesh.normals).toHaveLength(300);
    expect(mesh.positions[297]).toBe(99);
  });

  it("preserves every value across repeated doublings", () => {
    // Several growth steps, each of which copies the prefix into a new buffer.
    // A wrong copy length loses the tail of the previous buffer silently.
    const builder = new MeshBuilder();
    const COUNT = 1000;
    ramp(builder, COUNT);
    const { positions } = builder.build();
    for (let i = 0; i < COUNT; i++) expect(positions[i * 3]).toBe(i);
  });

  it("grows the index buffer independently of the vertex buffer", () => {
    // Indices grow at a different rate from positions (3 per triangle against
    // 3 per vertex), so sharing a length between them would truncate one.
    const builder = new MeshBuilder();
    ramp(builder, 3);
    for (let i = 0; i < 200; i++) builder.triangle(0, 1, 2);
    const mesh = builder.build();
    expect(mesh.indices).toHaveLength(600);
    expect(mesh.triangleCount).toBe(200);
    expect(mesh.positions).toHaveLength(9);
  });

  it("keeps colours aligned to positions across a growth boundary", () => {
    // The colour buffer is a third array with its OWN cursor, because `append`
    // writes it before the positions. That extra cursor is exactly what a
    // growth step can desynchronise.
    const builder = new MeshBuilder();
    builder.paint(0xff0000);
    ramp(builder, 100);
    const mesh = builder.build();
    expect(mesh.colours).toHaveLength(mesh.positions.length);
    expect(mesh.colours?.[297]).toBeCloseTo(1, 6);
    expect(mesh.colours?.[299]).toBeCloseTo(0, 6);
  });

  it("backfills white to the written prefix when paint arrives late", () => {
    // `ensureColours` fills white up to the CURRENT vertex count and no
    // further; filling the whole capacity would paint vertices that do not
    // exist yet with white instead of the colour they are about to be given.
    const builder = new MeshBuilder();
    ramp(builder, 100);
    builder.paint(0x00ff00);
    ramp(builder, 10);
    const colours = builder.build().colours;
    expect(colours).toHaveLength(330);
    expect(colours?.[0]).toBeCloseTo(1, 6); // backfilled white
    expect(colours?.[2]).toBeCloseTo(1, 6);
    expect(colours?.[300]).toBeCloseTo(0, 6); // painted green
    expect(colours?.[301]).toBeCloseTo(1, 6);
  });

  it("appends a mesh larger than the target's whole capacity", () => {
    // The merge path's normal case: an empty builder receives a mesh of
    // thousands of vertices in one call, so the growth loop has to double past
    // the requested size rather than allocate one step.
    const source = new MeshBuilder();
    ramp(source, 500);
    for (let i = 0; i < 100; i++) source.triangle(i, i + 1, i + 2);
    const mesh = source.build();

    const target = new MeshBuilder();
    target.append(mesh);
    const merged = target.build();
    expect(merged.positions).toEqual(mesh.positions);
    expect(merged.normals).toEqual(mesh.normals);
    expect(merged.indices).toEqual(mesh.indices);
  });

  it("re-bases indices when appending across a growth boundary", () => {
    // Two large meshes joined: the second's indices must be offset by the
    // first's VERTEX count, which is the write cursor divided by three rather
    // than the buffer length divided by three.
    const source = new MeshBuilder();
    ramp(source, 100);
    source.triangle(0, 1, 2);
    const mesh = source.build();

    const target = new MeshBuilder();
    target.append(mesh);
    target.append(mesh);
    const merged = target.build();
    expect(merged.positions).toHaveLength(600);
    // `triangle` reverses (a, c, b), so the first mesh emits 0, 2, 1.
    expect([...merged.indices]).toEqual([0, 2, 1, 100, 102, 101]);
  });

  it("rejects a mesh whose normals do not match its positions", () => {
    // Positions and normals share one write cursor, so a mismatch would
    // misalign every vertex after the join. The old element-wise loop wrote
    // NaN normals instead — equally wrong, and harder to trace back here.
    const target = new MeshBuilder();
    expect(() =>
      target.append({
        positions: new Float32Array(9),
        normals: new Float32Array(3),
        indices: new Uint32Array(0),
        triangleCount: 0,
        forcedEars: 0,
      }),
    ).toThrow(/normals/);
  });
});
