/**
 * Property test of the content watcher: random sequences of adds, attaches,
 * absolute and relative writes, removals, re-parenting, capture hints and
 * jumps, checked against an independent model of "the object's pose in the
 * current raw frame".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { configureStore } from '@reduxjs/toolkit';
import {
  arSpaceCorrectionReducer,
  relocalizationObserved,
} from '../state/ar-space-correction-slice';
import { enableArSpaceCorrection } from './ar-content-watcher';
import { poseCommitterOf } from './pose-committer';
import { WEBXR_TO_NUE } from './webxr-nue-basis';

const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const unitQuaternion = fc
  .tuple(num(-1, 1), num(-1, 1), num(-1, 1), num(-1, 1))
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => {
    const n = Math.hypot(...q);
    return new THREE.Quaternion(q[0] / n, q[1] / n, q[2] / n, q[3] / n);
  });
const rigid = fc
  .record({
    p: fc.tuple(num(-10, 10), num(-2, 2), num(-10, 10)),
    q: unitQuaternion,
  })
  .map(({ p, q }) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...p),
      q,
      new THREE.Vector3(1, 1, 1)
    )
  );

const ITEMS = 4;
const item = fc.nat({ max: ITEMS - 1 });
const where = fc.constantFrom('content', 'box', 'outside');
const op = fc.oneof(
  fc.record({ k: fc.constant('place' as const), i: item, where, pose: rigid }),
  fc.record({ k: fc.constant('attach' as const), i: item, where }),
  fc.record({ k: fc.constant('remove' as const), i: item }),
  fc.record({ k: fc.constant('absolute' as const), i: item, pose: rigid }),
  fc.record({
    k: fc.constant('relative' as const),
    i: item,
    dv: fc.tuple(num(-0.1, 0.1), num(-0.1, 0.1), num(-0.1, 0.1)),
  }),
  fc.record({
    k: fc.constant('hint' as const),
    i: item,
    back: fc.integer({ min: 0, max: 600 }),
    pose: rigid,
  }),
  fc.record({ k: fc.constant('jump' as const), jump: rigid }),
  fc.record({ k: fc.constant('excluded' as const), where }),
  fc.record({ k: fc.constant('moveBox' as const), pose: rigid }),
  fc.record({ k: fc.constant('noop' as const) })
);

type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

const localOf = (o: THREE.Object3D): THREE.Matrix4 =>
  new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);
const maxDiff = (a: THREE.Matrix4, b: THREE.Matrix4): number =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i]!)));

describe('ar-content-watcher (properties)', () => {
  it('every tracked object holds its pose in the current raw frame; untracked and excluded objects are never touched; a second sync changes nothing', () => {
    // Why this test matters: the app may add, move, re-parent and write its
    // objects in any order between jumps. Whatever it does, a watched
    // object's local transform must be its last placement carried through
    // exactly the jumps since that placement (from its capture time with a
    // hint), and nothing else may move.
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const store = configureStore({
          reducer: { arSpaceCorrection: arSpaceCorrectionReducer },
        });
        const arWorldGroup = new THREE.Group();
        const { arContent, arCorrection } = enableArSpaceCorrection({
          store,
          arWorldGroup,
        });
        const box = arCorrection.container(new THREE.Group());
        box.position.set(1, 0.5, -2);
        box.rotation.set(0.2, 0.9, -0.1);
        arContent.add(box);
        const outside = new THREE.Group();
        outside.position.set(-3, 0, 1);
        outside.rotation.y = -0.6;
        arWorldGroup.add(outside);
        const parents = { content: arContent, box, outside } as const;
        // Oracle: each parent's current transform into O, read by hand.
        const pOf = (parent: THREE.Object3D): THREE.Matrix4 =>
          parent === arContent
            ? new THREE.Matrix4()
            : parent === box
              ? localOf(box)
              : localOf(outside);
        const isWatched = (p: THREE.Object3D | null) =>
          p === arContent || p === box;

        const objects = Array.from(
          { length: ITEMS },
          () => new THREE.Object3D()
        );
        const model = objects.map(() => ({
          L: new THREE.Matrix4(),
          tracked: false,
        }));
        const excludedObj = new THREE.Object3D();
        excludedObj.position.set(0.3, 0.1, 0.2);
        arCorrection.exclude(excludedObj);
        const excludedLocal = localOf(excludedObj);
        const jumps: Array<{ t: number; d: THREE.Matrix4 }> = [];
        let t = 1000;

        const jumpOps = ops.filter((o) => o.k === 'jump').slice(0, 5);
        const cameraPose = (m: THREE.Matrix4) => {
          const p = new THREE.Vector3();
          const q = new THREE.Quaternion();
          m.decompose(p, q, new THREE.Vector3());
          return {
            position: [p.x, p.y, p.z] as [number, number, number],
            rotation: [q.x, q.y, q.z, q.w] as [number, number, number, number],
          };
        };
        type Of<K extends Op['k']> = Extract<Op, { k: K }>;
        const run: { [K in Op['k']]: (o: Of<K>) => void } = {
          jump(o) {
            if (!jumpOps.includes(o)) return;
            const camera = new THREE.Matrix4().makeTranslation(0, 1.5, 0);
            store.dispatch(
              relocalizationObserved({
                t,
                tLast: t - 33,
                lastPose: cameraPose(camera),
                tPrev: null,
                prevPose: null,
                newPose: cameraPose(o.jump.clone().multiply(camera)),
              })
            );
            const d = WEBXR_TO_NUE.clone()
              .multiply(o.jump)
              .multiply(WEBXR_TO_NUE.clone().invert());
            jumps.push({ t, d });
            objects.forEach((obj, i) => {
              if (!model[i]!.tracked) return;
              const p = pOf(obj.parent!);
              model[i]!.L = p
                .clone()
                .invert()
                .multiply(d)
                .multiply(p)
                .multiply(model[i]!.L);
            });
          },
          place(o) {
            const obj = objects[o.i]!;
            obj.removeFromParent();
            o.pose.decompose(obj.position, obj.quaternion, obj.scale);
            parents[o.where].add(obj);
            model[o.i] = { L: o.pose.clone(), tracked: o.where !== 'outside' };
          },
          attach(o) {
            const obj = objects[o.i]!;
            if (obj.parent === null) return;
            const from = pOf(obj.parent);
            parents[o.where].attach(obj);
            model[o.i] = {
              L: pOf(parents[o.where])
                .invert()
                .multiply(from)
                .multiply(model[o.i]!.L),
              tracked: o.where !== 'outside',
            };
          },
          remove(o) {
            objects[o.i]!.removeFromParent();
            model[o.i]!.tracked = false;
          },
          absolute(o) {
            const obj = objects[o.i]!;
            if (obj.parent === null) return;
            o.pose.decompose(obj.position, obj.quaternion, obj.scale);
            model[o.i]!.L = o.pose.clone();
          },
          relative(o) {
            const obj = objects[o.i]!;
            if (obj.parent === null) return;
            obj.position.add(new THREE.Vector3(...o.dv));
            model[o.i]!.L = new THREE.Matrix4()
              .makeTranslation(...o.dv)
              .multiply(model[o.i]!.L);
          },
          hint(o) {
            const obj = objects[o.i]!;
            obj.removeFromParent();
            const capturedAt = t - o.back;
            arCorrection.track(obj, { capturedAt });
            o.pose.decompose(obj.position, obj.quaternion, obj.scale);
            arContent.add(obj);
            const L = o.pose.clone();
            for (const j of jumps) if (j.t > capturedAt) L.premultiply(j.d);
            model[o.i] = { L, tracked: true };
          },
          excluded(o) {
            parents[o.where].add(excludedObj);
          },
          moveBox(o) {
            // A container moves (and turns) while it holds tracked items:
            // they keep their local transforms and move with it.
            o.pose.decompose(box.position, box.quaternion, box.scale);
          },
          noop() {
            store.dispatch({ type: 'unrelated/action' });
          },
        };
        for (const o of ops) {
          t += 100;
          (run[o.k] as (op: Op) => void)(o);
          const check = () => {
            objects.forEach((obj, i) => {
              expect(poseCommitterOf(obj)).toBe(
                model[i]!.tracked ? 'AR-space correction' : null
              );
              expect(model[i]!.tracked).toBe(isWatched(obj.parent));
              const drift =
                obj.parent === null ? 0 : maxDiff(localOf(obj), model[i]!.L);
              expect(drift).toBeLessThan(1e-8);
            });
            expect(maxDiff(localOf(excludedObj), excludedLocal)).toBe(0);
            expect(poseCommitterOf(excludedObj)).toBeNull();
            expect(poseCommitterOf(box)).toBeNull();
          };
          check();
          // A second sync (a notification with no new observation) moves nothing.
          store.dispatch({ type: 'unrelated/action' });
          check();
        }
        arCorrection.dispose();
      }),
      { numRuns: 150 }
    );
  });
});
