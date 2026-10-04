/**
 * OcclusionMesh shadow receiver: property-based tests (W4 AR shadows plan
 * 2026-09-26-0549, M1).
 *
 * Why this test matters: the receiver is one more skin in a class whose
 * other skins already had interleaving bugs (a stale debug surface after
 * `clear`, fixed 2026-07). The unit tests walk fixed orders; here ANY
 * interleaving of remesh, clear, visibility, debug style and receiver
 * switching must keep, after every step:
 *  1. at most one receiver, present iff the last receiver call was not null;
 *  2. the receiver on the occluder's CURRENT geometry object;
 *  3. its visibility equal to the last `setVisible`;
 *  4. its opacity equal to the last options given;
 *  5. one cached material for the whole life (no recompile per toggle);
 *  6. nothing the occluder owns ever casting;
 *  7. while a receiver is attached, a non-empty geometry carries a normal
 *     per vertex, whatever the debug style (round 3: three compiles the
 *     receiver once and draws no shadow if the normals it was compiled
 *     with vanish on a later remesh, which the Off and Wireframe skins did).
 */

import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { OCCLUDER_DEBUG_STYLES, OcclusionMesh } from './occlusion-mesh.js';

const RECEIVER_NAME = 'occupancy-occluder-shadow-receiver';
const CELL_SIZE = 0.16;

type Op =
  | { readonly kind: 'update'; readonly cells: [number, number, number][] }
  | { readonly kind: 'applyMeshData' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'setVisible'; readonly visible: boolean }
  | {
      readonly kind: 'setDebugStyle';
      readonly style: (typeof OCCLUDER_DEBUG_STYLES)[number];
    }
  | { readonly kind: 'receiver'; readonly opacity: number | null };

const cellArb = fc.tuple(
  fc.integer({ min: -3, max: 3 }),
  fc.integer({ min: -1, max: 1 }),
  fc.integer({ min: -3, max: 3 })
);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc
    .array(cellArb, { minLength: 0, maxLength: 12 })
    .map((cells): Op => ({ kind: 'update', cells })),
  fc.constant<Op>({ kind: 'applyMeshData' }),
  fc.constant<Op>({ kind: 'clear' }),
  fc.boolean().map((visible): Op => ({ kind: 'setVisible', visible })),
  fc
    .constantFrom(...OCCLUDER_DEBUG_STYLES)
    .map((style): Op => ({ kind: 'setDebugStyle', style })),
  fc
    .option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null })
    .map((opacity): Op => ({ kind: 'receiver', opacity }))
);

/** What the receiver should look like after the operations so far. */
interface Expected {
  on: boolean;
  opacity: number | null;
  visible: boolean;
}

/** Applies one operation to the occluder and to the expected state. */
function applyOp(occluder: OcclusionMesh, op: Op, expected: Expected): void {
  switch (op.kind) {
    case 'update':
      occluder.update(op.cells, CELL_SIZE);
      break;
    case 'applyMeshData':
      occluder.applyMeshData(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 1, 2])
      );
      break;
    case 'clear':
      occluder.clear();
      break;
    case 'setVisible':
      occluder.setVisible(op.visible);
      expected.visible = op.visible;
      break;
    case 'setDebugStyle':
      occluder.setDebugStyle(op.style);
      // A style change re-adds debug skins visible (documented
      // quirk); it must not touch the receiver's visibility.
      break;
    case 'receiver':
      occluder.setShadowReceiver(
        op.opacity === null ? null : { opacity: op.opacity }
      );
      expected.on = op.opacity !== null;
      if (op.opacity !== null) expected.opacity = op.opacity;
      break;
  }
}

describe('OcclusionMesh shadow receiver: any operation order', () => {
  it('holds the receiver invariants after every step', () => {
    fc.assert(
      fc.property(
        fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
        fc.array(opArb, { minLength: 1, maxLength: 25 }),
        (initial, ops) => {
          const parent = new THREE.Group();
          const occluder = new OcclusionMesh(
            parent,
            initial === null ? {} : { shadowReceiver: { opacity: initial } }
          );
          const expected: Expected = {
            on: initial !== null,
            opacity: initial,
            visible: true,
          };
          let material: THREE.Material | null = null;

          const check = (): void => {
            const receivers = parent.children.filter(
              (c) => c.name === RECEIVER_NAME
            ) as THREE.Mesh[];
            expect(receivers.length).toBe(expected.on ? 1 : 0);
            for (const node of parent.children) {
              expect(node.castShadow).toBe(false);
            }
            const skin = receivers[0];
            if (!skin) return;
            expect(skin.geometry).toBe(occluder.getMesh().geometry);
            const countOf = (name: string): number =>
              skin.geometry.hasAttribute(name)
                ? skin.geometry.getAttribute(name).count
                : 0;
            expect(countOf('normal')).toBe(countOf('position'));
            expect(skin.visible).toBe(expected.visible);
            const m = skin.material as THREE.ShadowMaterial;
            expect(m.opacity).toBe(expected.opacity);
            if (material === null) material = m;
            expect(m).toBe(material);
          };

          check();
          for (const op of ops) {
            applyOp(occluder, op, expected);
            check();
          }
          occluder.dispose();
          expect(parent.children).toHaveLength(0);
        }
      ),
      { numRuns: 300 }
    );
  });
});
