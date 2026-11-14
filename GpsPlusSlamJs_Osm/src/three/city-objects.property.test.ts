import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { TreePlacement, TreeVariant } from "../mesh/trees.js";
import { applyWoodsShare, cosmeticTreeObjects } from "./city-objects.js";
import { repackTreeLod } from "./trunk-trees.js";

/**
 * The woods share as a property: whatever the woods and the shares, a
 * smaller share draws a subset of a larger one (the rank prefix), full draws
 * every tree, and a non-empty wood never draws nothing. This is what keeps
 * the governor's thinning even and reversible, in both tree forms.
 */
const VARIANTS: readonly TreeVariant[] = [
  "broadleaved",
  "needleleaved",
  "unknown",
];

const woods = fc
  .array(
    fc.record({
      x: fc.double({ min: -400, max: 400, noNaN: true }),
      y: fc.double({ min: -400, max: 400, noNaN: true }),
      variant: fc.constantFrom(...VARIANTS),
    }),
    { minLength: 1, maxLength: 120 },
  )
  .map((list) =>
    list.map(({ x, y, variant }, i): TreePlacement => ({
      feature: `way/${i}`,
      position: { x, y },
      groundHeightM: 0,
      heightM: 10,
      crownDiameterM: 5,
      rotationY: 0,
      variant,
      colour: 0x336633,
    })),
  );
const share = fc.double({ min: 0.01, max: 1, noNaN: true });

/** The drawn trees, as their x positions, per mesh. */
function drawn(objects: readonly THREE.InstancedMesh[]): Set<string> {
  const out = new Set<string>();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const mesh of objects) {
    if (mesh.userData["treePart"] === "trunk") continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.add(`${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    }
  }
  return out;
}

describe("applyWoodsShare properties", () => {
  for (const form of ["crown", "trunk"] as const) {
    it(`draws a subset at a smaller share, every tree at full (${form})`, () => {
      fc.assert(
        fc.property(woods, share, share, (list, a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          const objects = cosmeticTreeObjects(list, { form });
          const at = (s: number): Set<string> => {
            const count = applyWoodsShare(objects, s);
            for (const mesh of objects)
              repackTreeLod(mesh, { x: 0, y: 0, z: 0 });
            const set = drawn(objects);
            expect(count).toBeGreaterThanOrEqual(1);
            return set;
          };
          const small = at(low);
          const large = at(high);
          for (const key of small) expect(large.has(key)).toBe(true);
          const all = at(1);
          expect(applyWoodsShare(objects, 1)).toBe(list.length);
          // Keyed as the GPU sees them: the matrices hold float32.
          const key = (t: TreePlacement): string =>
            `${Math.fround(t.position.x).toFixed(4)},${Math.fround(-t.position.y).toFixed(4)}`;
          expect(all.size).toBe(new Set(list.map(key)).size);
        }),
        { numRuns: 60 },
      );
    });
  }
});
