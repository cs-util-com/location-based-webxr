/**
 * Why this test matters: a loaded tile's model is a tree of arbitrary depth
 * (groups, meshes, other nodes). The lit-material swap must reach EVERY mesh
 * at any depth, or those patches of the globe stay unlit, and must leave the
 * tree itself alone. Random trees, not the one fixed shape of the unit test.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { useLitMaterial } from "./globe-surface.js";

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
          new THREE.MeshBasicMaterial(),
        )
      : s.kind === "group"
        ? new THREE.Group()
        : new THREE.Object3D();
  for (const child of s.children) node.add(build(child));
  return node;
}

describe("useLitMaterial for any model tree", () => {
  it("gives every mesh the lit material and keeps the tree", () => {
    fc.assert(
      fc.property(shape, (s) => {
        const model = build(s);
        let nodesBefore = 0;
        model.traverse(() => (nodesBefore += 1));
        const lit = new THREE.MeshStandardMaterial();
        useLitMaterial(model, lit);
        let nodesAfter = 0;
        let unlit = 0;
        model.traverse((node) => {
          nodesAfter += 1;
          if (node instanceof THREE.Mesh && node.material !== lit) unlit += 1;
        });
        expect(unlit).toBe(0);
        expect(nodesAfter).toBe(nodesBefore);
      }),
      { numRuns: 200 },
    );
  });
});
