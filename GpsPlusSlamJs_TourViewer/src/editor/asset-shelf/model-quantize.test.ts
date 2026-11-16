/**
 * Why these tests matter: quantizing rewrites where every vertex of a
 * model sits. A mistake does not fail loudly; it moves, tears or flips a
 * model in the tour. So each case is judged by an independent reader
 * (glTF-Transform, which applies the node transforms and the normalized
 * integers itself) against the original, and by the Khronos validator, and
 * every skip rule is pinned: each one guards a case where a box transform
 * on the node would draw the mesh in the wrong place.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import { type GlbParts, readGlb, writeGlb } from "./glb-file.js";
import { quantizeModel, type QuantizeSettings } from "./model-quantize.js";
import {
  boxSpec,
  buildModel,
  io,
  largestShift,
  type MeshSpec,
  REAL_MODELS,
  realModel,
  validatorErrors,
  worldPositions,
} from "./test-support/glb-fixtures.js";

const SETTINGS: QuantizeSettings = {
  positionBits: 16,
  normalBits: 8,
  texcoordBits: 16,
  maxPositionError: 0.0001,
};

/** The sweep's rows, appended to the file `MODEL_SWEEP_LOG` names when it
 *  is set (the test runner keeps a passing test's console quiet). */
function writeSweepRows(rows: readonly string[]): void {
  const file = process.env["MODEL_SWEEP_LOG"];
  if (file) appendFileSync(file, rows.join("\n") + "\n");
}

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

function quantized(
  bytes: Uint8Array,
  settings: QuantizeSettings = SETTINGS,
  edit: (parts: GlbParts) => void = () => {},
) {
  const parts = partsOf(bytes);
  edit(parts);
  const report = quantizeModel(parts, settings);
  const out = writeGlb(parts);
  return { report, out, json: parts.json };
}

/** `count` points spread off the integer grid of any box, so a
 *  quantization error is never zero by accident (a box's corners are). */
function cloud(name: string, count = 50, size = 7): MeshSpec {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i++) {
    positions[i] = ((i * 0.6180339887) % 1) * size;
  }
  return { name, positions };
}

const TURNED = {
  translation: [10, -2, 400] as [number, number, number],
  rotation: [0.2, 0.3, 0.1, Math.sqrt(1 - 0.14)] as [
    number,
    number,
    number,
    number,
  ],
  scale: [2, 0.5, 3] as [number, number, number],
};

describe("quantizeModel", () => {
  it("stores positions, normals and texture coordinates as integers that draw the same model", async () => {
    const before = await buildModel({
      meshes: [boxSpec("a", [100, 50, -20], 3), boxSpec("b", [0, 0, 0], 0.01)],
      transform: TURNED,
    });
    const { report, out, json } = quantized(before);
    expect(report).toMatchObject({
      positions: 2,
      normals: 2,
      texcoords: 2,
      indices: 2,
    });
    expect(json["extensionsRequired"]).toEqual(["KHR_mesh_quantization"]);
    expect(checkGlbInert(out).ok).toBe(true);
    expect(await validatorErrors(out)).toEqual([]);
    const { shift, diagonal } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    // Why: the error is measured in each mesh's own frame; the node scale
    // of up to 3 can stretch it, never more.
    expect(shift / diagonal).toBeLessThanOrEqual(
      report.positionError * 3 + 1e-12,
    );
    expect(report.positionError).toBeLessThan(0.00002);
    expect(report.normalErrorDeg).toBeLessThan(1);
  });

  it("keeps float positions when the error budget is tighter than the bits allow", async () => {
    const before = await buildModel({ meshes: [cloud("a")] });
    const { report, out } = quantized(before, {
      ...SETTINGS,
      positionBits: 8,
      maxPositionError: 0.0001,
    });
    expect(report.positions).toBe(0);
    const { shift } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    expect(shift).toBe(0);
  });

  it("gives meshes sharing one position list one box, and every instance its place", async () => {
    const before = await buildModel({
      meshes: [boxSpec("a", [1, 1, 1], 2), boxSpec("b")],
      sharePositions: true,
      instanceTwice: true,
      transform: TURNED,
    });
    const { report, out } = quantized(before);
    expect(report.positions).toBe(1);
    expect(await validatorErrors(out)).toEqual([]);
    const { shift, diagonal } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    expect(shift / diagonal).toBeLessThan(0.0001);
  });

  it("leaves an animated node its transform and its animation, and draws the mesh under it", async () => {
    const before = await buildModel({
      meshes: [boxSpec("a", [5, 5, 5])],
      animated: true,
      transform: TURNED,
    });
    const { report, out } = quantized(before);
    expect(report.positions).toBe(1);
    const doc = await io.readBinary(out);
    const channel = doc.getRoot().listAnimations()[0]!.listChannels()[0]!;
    const target = channel.getTargetNode()!;
    expect(target.getName()).toBe("node-a");
    expect(target.getTranslation()).toEqual(TURNED.translation);
    expect(target.listChildren()[0]!.getMesh()?.getName()).toBe("a");
    const { shift, diagonal } = largestShift(
      await worldPositions(before),
      await worldPositions(out),
    );
    expect(shift / diagonal).toBeLessThan(0.0001);
  });

  it("leaves the positions of skinned, morphed and GPU-instanced meshes as floats", async () => {
    // Why: a skinned mesh ignores its node's transform, a morph target's
    // offsets would need the same box, and an instancing extension's
    // transforms sit on the carrier node: a box undone on a new child node
    // would draw each of them in the wrong place.
    const skinned = quantized(
      await buildModel({ meshes: [boxSpec("a")], skinned: true }),
    );
    expect(skinned.report.positions).toBe(0);
    const morphed = quantized(
      await buildModel({ meshes: [boxSpec("a")], morphed: true }),
    );
    expect(morphed.report).toMatchObject({
      positions: 0,
      normals: 0,
      texcoords: 0,
    });
    const instanced = quantized(
      await buildModel({ meshes: [boxSpec("a")] }),
      SETTINGS,
      (parts) => {
        const node = (parts.json["nodes"] as Record<string, unknown>[])[0]!;
        node["extensions"] = { EXT_mesh_gpu_instancing: { attributes: {} } };
      },
    );
    expect(instanced.report.positions).toBe(0);
  });

  it("leaves texture coordinates outside 0..1 as floats", async () => {
    const spec = boxSpec("a");
    const tiled: MeshSpec = {
      ...spec,
      texcoords: spec.texcoords!.map((v) => v * 4),
    };
    const { report } = quantized(await buildModel({ meshes: [tiled] }));
    expect(report.texcoords).toBe(0);
    expect(report.positions).toBe(1);
  });

  it("narrows an index list to 16 bits up to index 65534, never 65535 (WebGL's restart index)", async () => {
    const line = (count: number): MeshSpec => {
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) positions[i * 3] = i / count;
      return {
        name: `line-${count}`,
        positions,
        indices: Uint32Array.of(0, 1, count - 1),
      };
    };
    const fits = quantized(await buildModel({ meshes: [line(65535)] }));
    expect(fits.report.indices).toBe(1);
    const restart = quantized(await buildModel({ meshes: [line(65536)] }));
    expect(restart.report.indices).toBe(0);
    expect(await validatorErrors(fits.out)).toEqual([]);
  });

  it("changes nothing and declares nothing for a model of points without floats", async () => {
    const { report, json } = quantized(await buildModel({ meshes: [] }));
    expect(report.positions + report.indices).toBe(0);
    expect(json["extensionsUsed"]).toBeUndefined();
  });
});

describe("quantizeModel on the repo's scanned models", () => {
  // The sweep the settings rest on: position bits against the error
  // budget, then normal bits. 16 bits keep any vertex within
  // sqrt(3)/2 * scale / 32767 of its place, at most 0.0013 % of the box's
  // diagonal, so a budget of 0.001 % may refuse them; 8 bits reach about
  // 0.34 %. The rows are printed so a change of default can be read off
  // the test log.
  const BUDGETS = [0.00001, 0.0001, 0.001, 0.01];
  for (const name of REAL_MODELS) {
    it(`${name}: 16-bit positions pass every budget from 0.01 %, 8-bit ones only 1 %`, async () => {
      const before = realModel(name);
      const original = await worldPositions(before);
      const rows: string[] = [];
      for (const positionBits of [16, 8] as const) {
        for (const maxPositionError of BUDGETS) {
          const { report, out } = quantized(before, {
            ...SETTINGS,
            positionBits,
            maxPositionError,
          });
          const { shift, diagonal } = largestShift(
            original,
            await worldPositions(out),
          );
          rows.push(
            `${name} positions ${positionBits} bit, budget ${maxPositionError * 100} %: ` +
              `${before.length} -> ${out.length} bytes, ` +
              `${report.positions ? "quantized" : "kept"}, ` +
              `world error ${((shift / diagonal) * 100).toFixed(5)} %`,
          );
          expect(shift / diagonal).toBeLessThanOrEqual(maxPositionError);
          // 16 bits must pass a budget from 0.01 %, 8 bits must fail one
          // up to 0.1 %; between, the model decides.
          const quantizedNow = report.positions > 0;
          const mustQuantize =
            positionBits === 16 && maxPositionError >= 0.0001;
          const mustKeep = positionBits === 8 && maxPositionError <= 0.001;
          expect(quantizedNow).toBe(
            mustQuantize || (!mustKeep && quantizedNow),
          );
          expect(checkGlbInert(out).ok).toBe(true);
        }
      }
      for (const normalBits of [8, 16] as const) {
        const { report, out } = quantized(before, {
          ...SETTINGS,
          normalBits,
        });
        rows.push(
          `${name} normals ${normalBits} bit: ${out.length} bytes, ` +
            `angle error ${report.normalErrorDeg.toFixed(4)} deg`,
        );
        expect(report.normalErrorDeg).toBeLessThan(normalBits === 8 ? 1 : 0.01);
        // The scanned files carry four orphan accessors with a byte
        // offset and no buffer view (the validator's only errors on them);
        // the optimizer must add none.
        expect(await validatorErrors(out)).toEqual(
          await validatorErrors(before),
        );
      }
      writeSweepRows(rows);
    }, 120_000);
  }
});
