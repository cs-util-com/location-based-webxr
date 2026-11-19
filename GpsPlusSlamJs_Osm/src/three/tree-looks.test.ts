import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { packInstances, type TreePlacement } from "../mesh/trees.js";
import { setTreeLookWeights, treeObjects } from "./city-objects.js";
import { repackTreeLod } from "./trunk-trees.js";

/**
 * The trees of a city baked in several colour looks: their crown colours
 * are mixed on the CPU into `instanceColor` (a uniform cannot reach one
 * colour per instance without a shader patch on a material every city
 * shares), through the trunk form's last LOD sort for that form.
 */

const RED = 0xff0000;
const BLUE = 0x0000ff;

function placement(x: number, lookColours?: readonly number[]): TreePlacement {
  return {
    feature: `node/${x}`,
    position: { x, y: 0 },
    groundHeightM: 0,
    heightM: 10,
    crownDiameterM: 6,
    rotationY: 0,
    variant: "broadleaved",
    colour: lookColours?.[0] ?? RED,
    ...(lookColours === undefined ? {} : { lookColours }),
  };
}

const linear = (rgb: number): number[] =>
  new THREE.Color().setHex(rgb, THREE.SRGBColorSpace).toArray();

/** Instance `i`'s colour of a crown mesh. */
const colourAt = (mesh: THREE.InstancedMesh, i: number): number[] =>
  Array.from(mesh.instanceColor?.array.slice(i * 3, i * 3 + 3) ?? []);

describe("packInstances with looks", () => {
  // WHY: the looks ride beside `colours` in the same sRGB 0-1 channels, so
  // look 0 is `colours` itself and a renderer converts both the same way.
  it("packs one colour array per look, look 0 equal to colours", () => {
    const packed = [...packInstances([placement(0, [RED, BLUE])]).values()][0]!;
    const looks = packed.lookColours!;
    expect(looks.length).toBe(2);
    expect(Array.from(looks[0]!)).toEqual(Array.from(packed.colours));
    expect(Array.from(looks[1]!)).toEqual([0, 0, 1]);
  });

  // WHY: a variant mixing trees with and without looks (or with different
  // counts) has no consistent look k; packing none keeps the fixed colours
  // rather than inventing a look for the trees that lack it.
  it("packs no looks when the variant's trees disagree on them", () => {
    const [packed] = packInstances([
      placement(0, [RED, BLUE]),
      placement(1),
    ]).values();
    expect(packed?.lookColours).toBeUndefined();
  });
});

describe("setTreeLookWeights", () => {
  // WHY: weight 1 on a look must draw what a fixed build of that look
  // draws (the frame-equality rule), and a half mix is the linear mean.
  it("mixes the crown form's colours in linear space", () => {
    const objects = treeObjects([placement(0, [RED, BLUE])]);
    const [mesh] = objects;
    expect(colourAt(mesh!, 0)).toEqual(linear(RED));
    expect(setTreeLookWeights(objects, [0, 1])).toBe(1);
    expect(colourAt(mesh!, 0)).toEqual(linear(BLUE));
    setTreeLookWeights(objects, [0.5, 0.5]);
    const mean = linear(RED).map((c, k) => (c + (linear(BLUE)[k] ?? 0)) / 2);
    colourAt(mesh!, 0).forEach((c, k) =>
      expect(c).toBeCloseTo(mean[k] ?? 0, 6),
    );
    expect(mesh?.instanceColor?.version).toBeGreaterThan(0);
  });

  // WHY: the trunk form copies colours into near and far slots at each
  // sort; a mix must land in the slot each tree holds NOW (the kept sort
  // order), and the next sort must carry the mix, not the old colour.
  it("rewrites the trunk form's sorted slots and keeps the mix across sorts", () => {
    const objects = treeObjects(
      [placement(0, [RED, BLUE]), placement(500, [RED, BLUE])],
      { form: "trunk" },
    );
    const crowns = objects.filter((m) => m.userData["treePart"] === "crown");
    const near = crowns.find((m) => m.userData["treeLevel"] === "near")!;
    const far = crowns.find((m) => m.userData["treeLevel"] === "far")!;
    repackTreeLod(near, { x: 0, y: 0, z: 0 });
    expect([near.count, far.count]).toEqual([1, 1]);
    expect(setTreeLookWeights(objects, [0, 1])).toBe(2);
    expect(colourAt(near, 0)).toEqual(linear(BLUE));
    expect(colourAt(far, 0)).toEqual(linear(BLUE));
    repackTreeLod(near, { x: 500, y: 0, z: 0 });
    expect(colourAt(near, 0)).toEqual(linear(BLUE));
    expect(colourAt(far, 0)).toEqual(linear(BLUE));
  });

  // WHY: a NaN or a negative weight would write NaN colours into every
  // instance with no error; a count other than the build's looks means the
  // app mixes looks the trees were not baked in.
  it("refuses bad weights and leaves trees without looks alone", () => {
    const looked = treeObjects([placement(0, [RED, BLUE])]);
    for (const bad of [[Number.NaN, 1], [-1, 2], [1], [0.5, 0.25, 0.25]]) {
      expect(() => setTreeLookWeights(looked, bad)).toThrow(RangeError);
    }
    const plain = treeObjects([placement(0)]);
    expect(setTreeLookWeights(plain, [0, 1])).toBe(0);
    expect(colourAt(plain[0]!, 0)).toEqual(linear(RED));
  });
});
