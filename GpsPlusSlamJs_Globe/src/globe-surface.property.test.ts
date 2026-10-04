/**
 * Why this test matters: a loaded tile's model is a tree of arbitrary depth
 * (groups, meshes, other nodes). The lit-material swap must reach EVERY mesh
 * at any depth, each keeping its OWN texture, or those patches of the globe
 * stay unlit or show another tile's imagery; it must leave the tree alone;
 * and the cleanup must free exactly the copies it made. Random trees, not
 * the one fixed shape of the unit test.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { disposeLitMaterials, useLitMaterial } from "./globe-surface.js";

type Shape = { kind: "mesh" | "node" | "group"; children: Shape[] };

const kind = fc.constantFrom<Shape["kind"]>("mesh", "node", "group");
// Bounded depth: an unbounded recursive arbitrary overflows the stack.
const shape: fc.Arbitrary<Shape> = fc.letrec<{ tree: Shape }>((tie) => ({
  tree: fc.oneof(
    { maxDepth: 5, depthIdentifier: "tree" },
    fc.record({ kind, children: fc.constant<Shape[]>([]) }),
    fc.record({
      kind,
      children: fc.array(tie("tree"), { maxLength: 3 }),
    }),
  ),
})).tree;

function build(s: Shape): THREE.Object3D {
  const node =
    s.kind === "mesh"
      ? new THREE.Mesh(
          new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial({ map: new THREE.Texture() }),
        )
      : s.kind === "group"
        ? new THREE.Group()
        : new THREE.Object3D();
  for (const child of s.children) node.add(build(child));
  return node;
}

describe("useLitMaterial for any model tree", () => {
  it("gives every mesh an owned lit copy with its own map, keeping the tree", () => {
    fc.assert(
      fc.property(shape, (s) => {
        const model = build(s);
        const maps = new Map<THREE.Object3D, THREE.Texture | null>();
        let nodesBefore = 0;
        model.traverse((node) => {
          nodesBefore += 1;
          if (node instanceof THREE.Mesh) {
            maps.set(node, (node.material as THREE.MeshBasicMaterial).map);
          }
        });
        const owned = new WeakSet<THREE.Material>();
        useLitMaterial(model, new THREE.MeshStandardMaterial(), owned);
        let nodesAfter = 0;
        let wrong = 0;
        model.traverse((node) => {
          nodesAfter += 1;
          if (!(node instanceof THREE.Mesh)) return;
          const lit = node.material as THREE.MeshStandardMaterial;
          if (!owned.has(lit) || lit.map !== maps.get(node)) wrong += 1;
        });
        expect(wrong).toBe(0);
        expect(nodesAfter).toBe(nodesBefore);
        disposeLitMaterials(model, owned);
        let stillOwned = 0;
        model.traverse((node) => {
          if (node instanceof THREE.Mesh && owned.has(node.material)) {
            stillOwned += 1;
          }
        });
        expect(stillOwned).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
