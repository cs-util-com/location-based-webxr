/**
 * Why these tests matter: the level-of-detail pass decides how many of a
 * model's triangles a tour keeps, and it rewrites the model's vertex
 * buffer to do so. A default level past the error budget shows a visibly
 * different rock; a chain the renderer cannot read crashes or draws
 * garbage; a skinned or animated model rewritten by a pass that ignores
 * its bones would deform wrongly. The fixtures are written by
 * glTF-Transform and the results read back by it and judged by the
 * Khronos validator, so the pass is never the judge of its own output.
 */
import { describe, expect, it } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  type GlbParts,
  type GltfObject,
  readAccessor,
  readGlb,
  writeGlb,
} from "./glb-file.js";
import { surfaceDistance } from "./mesh-distance.js";
import {
  LOD_CHAIN_LEVELS,
  type LodSettings,
  simplifyModel,
} from "./model-lod.js";
import {
  bendingTube,
  bendTube,
  boxSpec,
  buildModel,
  io,
  type MeshSpec,
  realModel,
  tubeSpec,
  validatorErrors,
} from "./test-support/glb-fixtures.js";
import { heightField, sphere } from "./test-support/meshes.js";

const SETTINGS: LodSettings = { lodBudget: 0.0025, lodMinTriangles: 2000 };
/** The bending tube has 1 280 triangles. */
const TUBE_SETTINGS: LodSettings = { lodBudget: 0.0025, lodMinTriangles: 500 };

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

function primitiveOf(parts: GlbParts, mesh = 0): GltfObject {
  const meshes = parts.json["meshes"] as GltfObject[];
  return (meshes[mesh]!["primitives"] as GltfObject[])[0]!;
}

interface SavedLod {
  readonly indices: number;
  readonly levels: { start: number; count: number; error: number }[];
}

const lodOf = (prim: GltfObject) =>
  (prim["extras"] as { lod?: SavedLod } | undefined)?.lod;

/** A bumpy closed sphere of 2 048 triangles (just above the floor), as a
 *  fixture mesh. */
function rockSpec(name = "rock", depth = 4): MeshSpec {
  const mesh = sphere(
    depth,
    1,
    (x, y, z) => 0.08 * Math.sin(4 * x + 3 * y * z),
  );
  return {
    name,
    positions: mesh.positions as Float32Array<ArrayBuffer>,
    normals: mesh.normals as Float32Array<ArrayBuffer>,
    texcoords: mesh.uvs as Float32Array<ArrayBuffer>,
    indices: mesh.indices as Uint32Array<ArrayBuffer>,
  };
}

/** The saved model's first primitive as glTF-Transform reads it: its
 *  positions, the author's level, and every level of the chain. */
async function readBack(bytes: Uint8Array) {
  const doc = await io.readBinary(bytes);
  const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const position = prim.getAttribute("POSITION")!;
  const positions = new Float32Array(position.getCount() * 3);
  const p: number[] = [];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, p);
    positions.set(p, 3 * i);
  }
  const lod = (prim.getExtras() as { lod: SavedLod }).lod;
  const chain = doc.getRoot().listAccessors()[lod.indices]!.getArray()!;
  return {
    positions,
    level: Uint32Array.from(prim.getIndices()!.getArray()!),
    chain: Uint32Array.from(chain),
    lod,
  };
}

/** The original first primitive's positions and indices, as floats. */
function originalOf(bytes: Uint8Array) {
  const parts = partsOf(bytes);
  const prim = primitiveOf(parts);
  const attributes = prim["attributes"] as Record<string, number>;
  return {
    positions: Float32Array.from(
      readAccessor(parts, attributes["POSITION"]!)!.values,
    ),
    indices: Uint32Array.from(
      readAccessor(parts, prim["indices"] as number)!.values,
    ),
  };
}

function diagonalOf(p: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, p[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, p[i]!);
  }
  return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/** A level of the tube against the whole tube, both bent by `degrees`, as
 *  a share of the bent tube's box diagonal. */
function posedDeviation(
  tube: MeshSpec,
  positions: Float32Array,
  level: Uint32Array,
  degrees: number,
): number {
  const whole = bendTube(tube.positions, degrees);
  const d = surfaceDistance(
    whole,
    tube.indices!,
    bendTube(positions, degrees),
    level,
  );
  return d.max / diagonalOf(whole);
}

// ordering and measuring a scanned model takes seconds, more on a loaded
// machine
describe("simplifyModel", { timeout: 30_000 }, () => {
  // Why: the default is the point of the pass: the fewest triangles whose
  // measured deviation stays within the budget, and a chain of coarser
  // levels the renderer can fall back to with distance.
  it("takes a scanned rock to its fewest triangles within the budget, compacts its vertices and saves a coarser chain", async () => {
    const before = realModel("rock");
    const parts = partsOf(before);
    const original = originalOf(before);
    const report = simplifyModel(parts, SETTINGS);
    expect(report.skipped).toBeNull();
    expect(report.primitives).toBe(1);
    expect(report.automatic).toBe(true);
    expect(report.trianglesBefore).toBe(original.indices.length / 3);
    expect(report.trianglesAfter).toBeLessThan(report.trianglesBefore * 0.95);
    expect(report.deviation).toBeLessThanOrEqual(SETTINGS.lodBudget);
    const bytes = writeGlb(parts);
    expect(checkGlbInert(bytes).ok).toBe(true);

    const saved = await readBack(bytes);
    expect(saved.level.length / 3).toBe(report.trianglesAfter);
    expect(saved.positions.length).toBeLessThan(original.positions.length);
    expect(Math.max(...saved.chain)).toBeLessThan(saved.positions.length / 3);
    const { levels } = saved.lod;
    expect(levels.length).toBeGreaterThanOrEqual(2);
    expect(levels.length).toBeLessThanOrEqual(1 + LOD_CHAIN_LEVELS);
    expect(levels[0]).toMatchObject({ start: 0, count: saved.level.length });
    expect(Array.from(saved.chain.subarray(0, saved.level.length))).toEqual(
      Array.from(saved.level),
    );
    for (let l = 1; l < levels.length; l++) {
      expect(levels[l]!.start).toBe(
        levels[l - 1]!.start + levels[l - 1]!.count,
      );
      expect(levels[l]!.count).toBeLessThan(levels[l - 1]!.count);
      expect(levels[l]!.error).toBeGreaterThanOrEqual(levels[l - 1]!.error);
    }
    const last = levels.at(-1)!;
    expect(last.start + last.count).toBe(saved.chain.length);

    // measured independently, from the file as another reader reads it
    const diagonal = Math.hypot(
      ...[0, 1, 2].map((c) => {
        const axis = original.positions.filter((_, i) => i % 3 === c);
        return Math.max(...axis) - Math.min(...axis);
      }),
    );
    const d = surfaceDistance(
      original.positions,
      original.indices,
      saved.positions,
      saved.level,
    );
    // a fresh sample of the surfaces may read a little above the pass's own
    expect(d.max / diagonal).toBeLessThanOrEqual(SETTINGS.lodBudget * 1.25);
    // the slider's choices: fewer triangles never read a smaller deviation
    // by more than sampling noise, and the full model reads none
    expect(report.choices[0]).toMatchObject({ share: 1, deviation: 0 });
    for (let i = 1; i < report.choices.length; i++) {
      expect(report.choices[i]!.triangles).toBeLessThanOrEqual(
        report.choices[i - 1]!.triangles,
      );
    }
  });

  // Why: the slider overrides the default; the saved level must follow it
  // and the report must say how far the author's level deviates.
  it("follows the author's share of triangles and reports its deviation", () => {
    const parts = partsOf(realModel("rock"));
    const report = simplifyModel(parts, { ...SETTINGS, detailShare: 0.25 });
    expect(report.automatic).toBe(false);
    expect(report.trianglesAfter).toBeLessThanOrEqual(
      Math.round(report.trianglesBefore * 0.25),
    );
    expect(report.trianglesAfter).toBeGreaterThan(report.trianglesBefore * 0.2);
    expect(report.deviation).toBeGreaterThan(SETTINGS.lodBudget);
    expect(lodOf(primitiveOf(parts))!.levels[0]!.error).toBe(report.deviation);
  });

  // Why: share 1 is "leave it as drawn": every triangle stays, and only a
  // chain is added.
  it("keeps every triangle at share 1", () => {
    const parts = partsOf(realModel("rock"));
    const report = simplifyModel(parts, { ...SETTINGS, detailShare: 1 });
    expect(report.trianglesAfter).toBe(report.trianglesBefore);
    expect(report.deviation).toBe(0);
  });

  // Why: a flat open patch can collapse to nothing at the end of its
  // order; a level of no triangles would make the model vanish, so the
  // coarsest a level gets is the last step that leaves a triangle (found
  // by the property test at share 0).
  it("never saves an empty level, even at share 0", async () => {
    const patch = heightField(6, () => 0);
    const parts = partsOf(
      await buildModel({
        meshes: [
          {
            name: "patch",
            positions: patch.positions as Float32Array<ArrayBuffer>,
            normals: patch.normals as Float32Array<ArrayBuffer>,
            texcoords: patch.uvs as Float32Array<ArrayBuffer>,
            indices: patch.indices as Uint32Array<ArrayBuffer>,
          },
        ],
      }),
    );
    const report = simplifyModel(parts, {
      lodBudget: 0.0025,
      lodMinTriangles: 50,
      detailShare: 0,
    });
    expect(report.trianglesAfter).toBeGreaterThan(0);
    expect(Number.isFinite(report.deviation)).toBe(true);
    for (const level of lodOf(primitiveOf(parts))!.levels) {
      expect(level.count).toBeGreaterThan(0);
    }
  });

  // Why: a small model gains nothing from levels, and the floor keeps a
  // hand-made prop exactly as its maker drew it.
  it("leaves a model under the triangle floor as it is", async () => {
    const parts = partsOf(await buildModel({ meshes: [boxSpec("box")] }));
    const before = JSON.stringify(parts.json);
    const report = simplifyModel(parts, SETTINGS);
    expect(report.primitives).toBe(0);
    expect(JSON.stringify(parts.json)).toBe(before);
  });

  // Why: a skinned model's shape changes with its bones. A tube's straight
  // side is flat at rest, so a level judged at rest only drops the rings
  // the bend needs, and the bent tube then cuts its corner. The pass must
  // measure the deviation in the clip's poses and refuse that level; it is
  // judged here at the clip's poses and at one in between (45 degrees, not
  // a pose the pass samples), by a skinning written in the test.
  it("refuses a level that is fine at rest but tears when a skinned model bends", async () => {
    const tube = tubeSpec();
    const plain = partsOf(await buildModel({ meshes: [tube] }));
    const restOnly = simplifyModel(plain, TUBE_SETTINGS);
    const restLevel = await readBack(writeGlb(plain));
    expect(
      posedDeviation(tube, restLevel.positions, restLevel.level, 0),
    ).toBeLessThanOrEqual(TUBE_SETTINGS.lodBudget * 1.25);
    // the rest-only level tears when bent
    expect(
      posedDeviation(tube, restLevel.positions, restLevel.level, 90),
    ).toBeGreaterThan(TUBE_SETTINGS.lodBudget * 4);

    const parts = partsOf(await bendingTube({ clip: true }));
    const report = simplifyModel(parts, TUBE_SETTINGS);
    expect(report.primitives).toBe(1);
    expect(report.trianglesAfter).toBeLessThan(report.trianglesBefore * 0.9);
    expect(report.trianglesAfter).toBeGreaterThan(restOnly.trianglesAfter);
    expect(report.deviation).toBeLessThanOrEqual(TUBE_SETTINGS.lodBudget);
    const bytes = writeGlb(parts);
    expect(await validatorErrors(bytes)).toEqual([]);
    const saved = await readBack(bytes);
    for (const degrees of [0, 30, 45, 60, 90]) {
      expect(
        posedDeviation(tube, saved.positions, saved.level, degrees),
      ).toBeLessThanOrEqual(TUBE_SETTINGS.lodBudget * 1.25);
    }
  });

  // Why: a skinned model without a clip may still be posed by whoever
  // shows it, and the rest pose is all the pass can measure; so its
  // default level keeps at least half its triangles. The author's share
  // still overrides that.
  it("keeps at least half of a skinned model without clips at its default level", async () => {
    const parts = partsOf(await bendingTube({ clip: false }));
    const report = simplifyModel(parts, TUBE_SETTINGS);
    expect(report.primitives).toBe(1);
    expect(report.trianglesAfter).toBeGreaterThanOrEqual(
      Math.ceil(report.trianglesBefore * 0.5),
    );
    expect(report.trianglesAfter).toBeLessThan(report.trianglesBefore);
    const chosen = partsOf(await bendingTube({ clip: false }));
    expect(
      simplifyModel(chosen, { ...TUBE_SETTINGS, detailShare: 0.2 })
        .trianglesAfter,
    ).toBeLessThanOrEqual(Math.round(report.trianglesBefore * 0.2));
  });

  // Why: a clip that only moves a node moves the model rigidly, which does
  // not change its shape, so an animated model is given levels like a
  // still one.
  it("gives an animated, unskinned model levels within the budget", async () => {
    const parts = partsOf(
      await buildModel({ meshes: [rockSpec()], animated: true }),
    );
    const report = simplifyModel(parts, SETTINGS);
    expect(report.primitives).toBe(1);
    expect(report.deviation).toBeLessThanOrEqual(SETTINGS.lodBudget);
  });

  // Why: the bones are untrusted input; a vertex bound to a joint the skin
  // does not have, or a skinned primitive no skin binds, cannot be posed,
  // so it is left exactly as it is rather than measured wrongly.
  it.each([
    [
      "names a joint its skin does not have",
      (json: GltfObject) => {
        const skin = (json["skins"] as GltfObject[])[0]!;
        skin["joints"] = (skin["joints"] as number[]).slice(0, 1);
        delete skin["inverseBindMatrices"];
      },
    ],
    [
      "is bound by no skin",
      (json: GltfObject) => {
        for (const node of json["nodes"] as GltfObject[]) delete node["skin"];
        delete json["skins"];
      },
    ],
  ])("leaves a skinned primitive that %s as it is", async (_, damage) => {
    const parts = partsOf(await bendingTube({ clip: true }));
    damage(parts.json);
    const json = JSON.stringify(parts.json);
    const report = simplifyModel(parts, TUBE_SETTINGS);
    expect(report.primitives).toBe(0);
    expect(report.skipped).toMatch(/posed/);
    expect(JSON.stringify(parts.json)).toBe(json);
  });

  // Why: these primitives cannot be cut down safely: a morph target's
  // offsets are per vertex too, and a vertex buffer another primitive
  // also draws from would lose that primitive's vertices.
  it.each([
    // the other mesh is plain, so it is simplified
    ["with morph targets", { morphed: true }, 1],
    ["whose positions another mesh shares", { sharePositions: true }, 0],
  ])("leaves a primitive %s as it is", async (_, extra, simplified) => {
    const parts = partsOf(
      await buildModel({
        meshes: [rockSpec("a"), rockSpec("b")],
        ...extra,
      }),
    );
    const report = simplifyModel(parts, SETTINGS);
    expect(lodOf(primitiveOf(parts, 0))).toBeUndefined();
    expect(report.primitives).toBe(simplified);
    expect(lodOf(primitiveOf(parts, 1)) !== undefined).toBe(simplified === 1);
  });

  // Why: running the pass twice (a second optimization of an already
  // optimized file) must not simplify the author's level again.
  it("leaves a primitive that already has levels as it is", async () => {
    const parts = partsOf(await buildModel({ meshes: [rockSpec()] }));
    simplifyModel(parts, SETTINGS);
    const again = partsOf(writeGlb(parts));
    const json = JSON.stringify(again.json);
    expect(simplifyModel(again, SETTINGS).primitives).toBe(0);
    expect(JSON.stringify(again.json)).toBe(json);
  });

  // Why: the saved chain is a second accessor over the index view and a
  // field in extras; the file must stay valid glTF for every viewer, and
  // the primitive's own extras must survive.
  it("writes a model the Khronos validator accepts, keeping the primitive's extras", async () => {
    const parts = partsOf(await buildModel({ meshes: [rockSpec("r", 5)] }));
    primitiveOf(parts)["extras"] = { maker: "scan" };
    const report = simplifyModel(parts, SETTINGS);
    expect(report.primitives).toBe(1);
    const bytes = writeGlb(parts);
    expect(await validatorErrors(bytes)).toEqual([]);
    expect(primitiveOf(partsOf(bytes))["extras"]).toMatchObject({
      maker: "scan",
    });
  });
});
