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
