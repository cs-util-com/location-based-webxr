/**
 * Why these tests matter: one drop can carry a model's text, its data, its
 * pictures and unrelated tour files together. The plan decides which file
 * goes where, and a file claimed twice would be added twice (once inside
 * the model, once on its own), while a file claimed by no one would vanish
 * without a word. A model part dropped alone must be refused in words, not
 * silently ignored, and a picture must reach the tour on its own when no
 * model in the drop could use it.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { planImport } from "./import-plan.js";
import { refusal } from "./model-import-words.js";

describe("planImport", () => {
  it("gives a model its data and the drop's pictures, and holds the pictures back", () => {
    const plan = planImport(["bust.gltf", "bust.bin", "wood.png", "a.mp3"]);
    expect(plan.imports).toEqual([
      { primary: 0, format: "gltf", parts: [1, 2] },
    ]);
    expect(plan.held).toEqual([2]);
    expect(plan.plain).toEqual([3]);
    expect(plan.refused).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it("offers every loose part to every model of the drop", () => {
    const plan = planImport(["a.gltf", "x.bin", "b.GLTF", "t.TGA"]);
    expect(plan.imports).toEqual([
      { primary: 0, format: "gltf", parts: [1, 3] },
      { primary: 2, format: "gltf", parts: [1, 3] },
    ]);
  });

  it("converts a zip on its own, and leaves pictures plain when no model is loose", () => {
    const plan = planImport(["bust.zip", "photo.jpg", "scene.glb"]);
    expect(plan.imports).toEqual([{ primary: 0, format: "zip", parts: [] }]);
    expect(plan.plain).toEqual([1, 2]);
    expect(plan.held).toEqual([]);
  });

  it("refuses a model part dropped without its model, in words", () => {
    const plan = planImport([
      "bust.bin",
      "wood.mtl",
      "skin.tga",
      "x.bmp",
      "b.zip",
    ]);
    expect(plan.imports).toEqual([{ primary: 4, format: "zip", parts: [] }]);
    expect(plan.refused).toEqual([
      { index: 0, reason: refusal.loneModelPart("bust.bin") },
      { index: 1, reason: refusal.loneModelPart("wood.mtl") },
      { index: 2, reason: refusal.lonePictureKind("skin.tga") },
      { index: 3, reason: refusal.lonePictureKind("x.bmp") },
    ]);
  });

  it("names the files it knows nothing of", () => {
    expect(planImport(["notes.txt", "README"]).unknown).toEqual([0, 1]);
  });
});

describe("planImport, properties", () => {
  const name = fc
    .tuple(
      fc.constantFrom("a", "B", "model", "x y"),
      fc.constantFrom(
        "gltf",
        "GLTF",
        "zip",
        "bin",
        "mtl",
        "tga",
        "bmp",
        "png",
        "jpg",
        "glb",
        "mp3",
        "txt",
        "",
      ),
    )
    .map(([stem, ext]) => (ext === "" ? stem : `${stem}.${ext}`));

  it("claims every file exactly once, and holds a picture only for a loose model", () => {
    fc.assert(
      fc.property(fc.array(name, { maxLength: 12 }), (names) => {
        const plan = planImport(names);
        const claimed = [
          ...plan.imports.map((i) => i.primary),
          ...plan.plain,
          ...plan.held,
          ...plan.refused.map((r) => r.index),
          ...plan.unknown,
          ...[...new Set(plan.imports.flatMap((i) => i.parts))].filter(
            (p) => !plan.held.includes(p),
          ),
        ];
        expect(new Set(claimed).size).toBe(claimed.length);
        expect([...new Set(claimed)].sort((a, b) => a - b)).toEqual(
          names.map((_, i) => i),
        );
        const loose = plan.imports.some((i) => i.format === "gltf");
        expect(loose || plan.held.length === 0).toBe(true);
        for (const held of plan.held) {
          expect(plan.plain).not.toContain(held);
        }
      }),
    );
  });
});
