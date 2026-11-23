import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { configureStore } from '@reduxjs/toolkit';
import {
  arSpaceCorrectionReducer,
  relocalizationObserved,
  selectCorrectionTrack,
  type RelocalizationObservation,
} from '../state/ar-space-correction-slice';
import { shownLocalMatrix } from './ar-space-correction';
import type { Pose } from './qr/qr-pose';
import { createArSpaceCorrectionRegistry } from './ar-space-correction-registry';
import { claimPose, poseCommitterOf, releasePose } from './pose-committer';
import { LogLevel, subscribeToLogs } from '../utils/logger';

const newStore = () =>
  configureStore({
    reducer: { arSpaceCorrection: arSpaceCorrectionReducer },
  });

const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const unitQuaternion = fc
  .tuple(num(-1, 1), num(-1, 1), num(-1, 1), num(-1, 1))
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q): [number, number, number, number] => {
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  });
const pose = fc.record({
  position: fc.tuple(num(-20, 20), num(-3, 3), num(-20, 20)),
  rotation: unitQuaternion,
});

const STILL_CAMERA: Pose = { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] };

/** An observation whose frame switch is `jump` (a still camera). */
function jumpObservation(t: number, jump: Pose): RelocalizationObservation {
  const m = new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...jump.position),
      new THREE.Quaternion(...jump.rotation),
      new THREE.Vector3(1, 1, 1)
    )
    .multiply(new THREE.Matrix4().makeTranslation(...STILL_CAMERA.position));
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  return {
    t,
    tLast: t - 33,
    lastPose: STILL_CAMERA,
    tPrev: null,
    prevPose: null,
    newPose: { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] },
  };
}

const localOf = (o: THREE.Object3D): number[] =>
  new THREE.Matrix4().compose(o.position, o.quaternion, o.scale).toArray();

const maxDiff = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

const matrixOfPose = (p: Pose): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion(...p.rotation),
    new THREE.Vector3(1, 1, 1)
  );

function setLocal(o: THREE.Object3D, p: Pose, scale = 1): void {
  o.position.set(...p.position);
  o.quaternion.set(...p.rotation);
  o.scale.setScalar(scale);
}

describe('ar-space-correction-registry', () => {
  it('an object not written after tracking holds P^-1 * Delta(e) * P * X_tracked after any jumps, and re-syncing changes nothing', () => {
    // Why this test matters: the bake is incremental (one M per jump), but
    // its result must equal the from-scratch formula over the whole track,
    // for any parent chain (one to three groups with uniform scales, at
    // least one drawn from a manual matrix), epoch and jump sequence; and a
    // notification that brings no new observation must not move anything
    // (idempotence). three.js is the oracle.
    const chainLink = fc.record({
      pose,
      scale: num(0.5, 2),
      manual: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(pose, { minLength: 0, maxLength: 5 }),
        fc.nat(),
        fc.array(chainLink, { minLength: 1, maxLength: 3 }),
        fc.nat(),
        pose,
        num(0.2, 3),
        (jumps, rawCut, links, rawManual, xPose, scale) => {
          const cut = rawCut % (jumps.length + 1);
          const forcedManual = rawManual % links.length;
          const store = newStore();
          const group = new THREE.Group();
          const pOracle = new THREE.Matrix4();
          let parent: THREE.Object3D = group;
          links.forEach((link, i) => {
            const node = new THREE.Group();
            setLocal(node, link.pose, link.scale);
            const local = localOf(node);
            if (link.manual || i === forcedManual) {
              node.updateMatrix();
              node.matrixAutoUpdate = false;
              // A manual node is drawn from its matrix; its position is
              // stale on purpose, so a reader of position would be wrong.
              node.position.set(99, 99, 99);
            }
            pOracle.multiply(new THREE.Matrix4().fromArray(local));
            parent.add(node);
            parent = node;
          });
          const object = new THREE.Object3D();
          setLocal(object, xPose, scale);
          parent.add(object);
          const xTracked = localOf(object);
          const registry = createArSpaceCorrectionRegistry({ group });
          registry.attach(store);
          // The object's pose was computed before the first `cut` jumps
          // were observed: it belongs to epoch 0 of the full sequence.
          jumps
            .slice(0, cut)
            .forEach((j, i) =>
              store.dispatch(
                relocalizationObserved(jumpObservation(1000 * (i + 1), j))
              )
            );
          registry.track(object, { epoch: 0 });
          jumps
            .slice(cut)
            .forEach((j, i) =>
              store.dispatch(
                relocalizationObserved(jumpObservation(1000 * (cut + i + 1), j))
              )
            );
          const delta0 = selectCorrectionTrack(store.getState())[0]!;
          const d = new THREE.Matrix4().compose(
            new THREE.Vector3(...delta0.position),
            new THREE.Quaternion(...delta0.rotation),
            new THREE.Vector3(1, 1, 1)
          );
          const expected = pOracle
            .clone()
            .invert()
            .multiply(d)
            .multiply(pOracle)
            .multiply(new THREE.Matrix4().fromArray(xTracked))
            .toArray();
          expect(maxDiff(localOf(object), expected)).toBeLessThan(1e-8);
          expect(object.scale.x).toBeCloseTo(scale, 12);
          const before = localOf(object);
          store.dispatch({ type: 'unrelated/action' });
          store.dispatch(
            relocalizationObserved({
              ...jumpObservation(1, jumps[0] ?? STILL_CAMERA),
              t: Number.NaN,
            })
          );
          expect(localOf(object)).toEqual(before);
          expect(registry.entryOf(object)!.applied).toBe(jumps.length);
          registry.dispose();
        }
      )
    );
  });

  it('an object tracked with an older epoch gets its Delta at tracking', () => {
    // Why this test matters: a pose computed before a jump and handed over
    // after it (an async tile) must be corrected at once, not at the next
    // jump.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    const tile = new THREE.Object3D();
    tile.position.set(1, 0, 0);
    group.add(tile);
    registry.track(tile, { capturedAt: 999 });
    // D in O: a 3 m step along raw +X is the NUE image of that vector.
    const d = selectCorrectionTrack(store.getState())[0]!;
    expect(tile.position.toArray()).toEqual(
      new THREE.Vector3(1, 0, 0).add(new THREE.Vector3(...d.position)).toArray()
    );
    expect(registry.entryOf(tile)).toMatchObject({
      applied: 1,
      stampedAt: 999,
    });

    const fresh = new THREE.Object3D();
    fresh.position.set(1, 0, 0);
    group.add(fresh);
    registry.track(fresh, { capturedAt: 1000 });
    expect(fresh.position.toArray()).toEqual([1, 0, 0]);
    registry.track(fresh);
    expect(fresh.position.toArray()).toEqual([1, 0, 0]);
  });

  it('bakes into position and quaternion, keeps the scale, and updates a manual matrix too', () => {
    // Why this test matters: the app reads its own position after a jump
    // (the bake is visible by design), and an object with
    // matrixAutoUpdate = false is drawn from its matrix, not its position.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const manual = new THREE.Object3D();
    manual.position.set(0, 0, -2);
    manual.scale.set(2, 2, 2);
    manual.updateMatrix();
    manual.matrixAutoUpdate = false;
    group.add(manual);
    registry.track(manual);
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, {
          position: [1, 0, 0],
          rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)],
        })
      )
    );
    expect(manual.scale.toArray()).toEqual([2, 2, 2]);
    expect(
      maxDiff(
        manual.matrix.toArray(),
        new THREE.Matrix4()
          .compose(manual.position, manual.quaternion, manual.scale)
          .toArray()
      )
    ).toBeLessThan(1e-12);
    expect(
      manual.position.distanceTo(new THREE.Vector3(0, 0, -2))
    ).toBeGreaterThan(0.5);
  });

  it('a relative write after a jump starts from the corrected pose', () => {
    // Why this test matters: this is why the bake was chosen; a bobbing
    // coin keeps its correction instead of jumping back by |D|.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const coin = new THREE.Object3D();
    group.add(coin);
    registry.track(coin);
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    const corrected = coin.position.clone();
    coin.position.y += 0.01;
    store.dispatch({ type: 'unrelated/action' });
    expect(coin.position.distanceTo(corrected)).toBeCloseTo(0.01, 12);
  });

  it('a store swap keeps every pose and applies the next jump exactly once', () => {
    // Why this test matters: a new recording in the same AR session brings a
    // new store whose epoch starts again; the objects are already in the
    // current frame, so nothing may move at the swap, and a jump in the new
    // store must not be applied together with the old store's jumps.
    const first = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    const detachFirst = registry.attach(first);
    const coin = new THREE.Object3D();
    group.add(coin);
    registry.track(coin);
    first.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    const afterFirst = coin.position.clone();
    const second = newStore();
    registry.attach(second);
    expect(coin.position.toArray()).toEqual(afterFirst.toArray());
    first.dispatch(
      relocalizationObserved(
        jumpObservation(2000, { position: [5, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    expect(coin.position.toArray()).toEqual(afterFirst.toArray());
    second.dispatch(
      relocalizationObserved(
        jumpObservation(500, { position: [0, 0, 1], rotation: [0, 0, 0, 1] })
      )
    );
    const step = selectCorrectionTrack(second.getState())[0]!.position;
    expect(
      coin.position.distanceTo(
        afterFirst.clone().add(new THREE.Vector3(...step))
      )
    ).toBeLessThan(1e-12);
    detachFirst(); // a stale detach must not detach the second store
    second.dispatch(
      relocalizationObserved(
        jumpObservation(600, { position: [0, 0, 1], rotation: [0, 0, 0, 1] })
      )
    );
    expect(registry.entryOf(coin)!.applied).toBe(2);
  });

  it('untrack stops the correction and frees the object for another committer', () => {
    // Why this test matters: an untracked object must keep its last pose
    // and become available to an anchor.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const coin = new THREE.Object3D();
    group.add(coin);
    registry.track(coin);
    expect(poseCommitterOf(coin)).toBe('AR-space correction');
    registry.untrack(coin);
    expect(poseCommitterOf(coin)).toBeNull();
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    expect(coin.position.toArray()).toEqual([0, 0, 0]);
    claimPose(coin, 'GPS anchor');
    releasePose(coin, 'GPS anchor');
    registry.track(coin);
    registry.dispose();
    expect(poseCommitterOf(coin)).toBeNull();
  });

  it('refuses an object an anchor commits, and an anchor refuses a tracked object', () => {
    // Why this test matters: one committer per object. An anchored object
    // moved by the correction as well would receive the jump twice (the
    // anchor re-fits it against the new frame anyway).
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const anchored = new THREE.Object3D();
    group.add(anchored);
    claimPose(anchored, 'deferred anchor');
    expect(() => registry.track(anchored)).toThrow(/deferred anchor/);
    const child = new THREE.Object3D();
    anchored.add(child);
    expect(() => registry.track(child)).toThrow(/nested/);
    releasePose(anchored, 'deferred anchor');

    const coin = new THREE.Object3D();
    group.add(coin);
    registry.track(coin);
    expect(() => claimPose(coin, 'GPS anchor')).toThrow(/AR-space correction/);
    registry.track(coin); // re-tracking keeps its own claim

    // The sanctioned path: the correction is computed by the pure helpers
    // (no claim) and an anchor commits it, as the only committer.
    const visitor = new THREE.Object3D();
    group.add(visitor);
    claimPose(visitor, 'deferred anchor');
    const target = shownLocalMatrix(
      selectCorrectionTrack(store.getState())[0]!,
      new THREE.Matrix4().toArray(),
      visitor.matrix.toArray()
    );
    expect(target).toHaveLength(16);
    expect(poseCommitterOf(visitor)).toBe('deferred anchor');
    releasePose(visitor, 'deferred anchor');
  });

  it('refuses bad input: no store, an object outside the group, bad epochs', () => {
    // Why this test matters: each of these would place content in a
    // made-up frame; they are programming errors and throw at the call.
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    const coin = new THREE.Object3D();
    group.add(coin);
    expect(() => registry.track(coin)).toThrow(/no store/);
    registry.attach(newStore());
    expect(() => registry.track(new THREE.Object3D())).toThrow(RangeError);
    expect(() => registry.track(coin, { epoch: 1 })).toThrow(RangeError);
    expect(() => registry.track(coin, { epoch: 0.5 })).toThrow(RangeError);
    expect(() => registry.track(coin, { epoch: 0, capturedAt: 1 })).toThrow(
      TypeError
    );
    expect(() => registry.track(coin, { capturedAt: Number.NaN })).toThrow(
      TypeError
    );
    expect(() => registry.track({} as THREE.Object3D)).toThrow(TypeError);
    expect(poseCommitterOf(coin)).toBeNull();
    expect(() =>
      createArSpaceCorrectionRegistry({ group: {} as THREE.Object3D })
    ).toThrow(TypeError);
  });

  it('refuses a parent chain the rigid correction cannot pass through, before claiming', () => {
    // Why this test matters: P^-1 * D * P is rigid only for a similarity P.
    // A non-uniform scale or a shear would turn the bake into a distortion
    // that position and quaternion cannot hold, so the object would drift;
    // and a refused object must stay free for another committer.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const cases: Array<[string, (n: THREE.Object3D) => void]> = [
      ['a non-uniform scale', (n) => n.scale.set(1, 2, 1)],
      ['a zero scale', (n) => n.scale.setScalar(0)],
      [
        'a shear',
        (n) => {
          n.matrix.set(1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
          n.matrixAutoUpdate = false;
        },
      ],
      ['a NaN position', (n) => n.position.set(Number.NaN, 0, 0)],
    ];
    for (const [, spoil] of cases) {
      const parent = new THREE.Group();
      spoil(parent);
      group.add(parent);
      const object = new THREE.Object3D();
      parent.add(object);
      expect(() => registry.track(object)).toThrow(RangeError);
      expect(poseCommitterOf(object)).toBeNull();
    }
    // Control: a uniform scale and a rotation are accepted.
    const scaled = new THREE.Group();
    scaled.scale.setScalar(2.5);
    scaled.rotation.set(0.3, 1.1, -0.4);
    group.add(scaled);
    const ok = new THREE.Object3D();
    scaled.add(ok);
    registry.track(ok);
    expect(poseCommitterOf(ok)).toBe('AR-space correction');
    registry.dispose();
  });

  it('one object whose bake throws is logged and skipped; the others are still corrected', () => {
    // Why this test matters: the bake runs inside a store notification; an
    // exception there would stop every later object (and every later
    // subscriber) from seeing the jump.
    const errors: string[] = [];
    const unsubscribe = subscribeToLogs((entry) => {
      if (entry.tag === 'ArSpaceCorrection' && entry.level === LogLevel.ERROR) {
        errors.push(entry.message);
      }
    });
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const broken = new THREE.Object3D();
    const healthy = new THREE.Object3D();
    group.add(broken, healthy);
    registry.track(broken);
    registry.track(healthy);
    broken.quaternion.premultiply = () => {
      throw new Error('broken object');
    };
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    expect(healthy.position.length()).toBeCloseTo(3, 9);
    expect(registry.entryOf(healthy)!.applied).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/broken object/);
    unsubscribe();
    registry.dispose();
  });

  it('an explicitly tracked object is untracked when removed or re-parented, and at the next jump when its parent left the group, never moved', () => {
    // Why this test matters: under a new parent, or outside the group, the
    // bake would apply a correction in the wrong frame. The registry cannot
    // know the new placement, so it lets go. A removal is seen at once (a
    // tile cache that evicts with remove() must not leave entries behind
    // until the next jump); a parent leaving the group is seen at the jump,
    // with a warning.
    const warnings: string[] = [];
    const unsubscribe = subscribeToLogs((entry) => {
      if (entry.tag === 'ArSpaceCorrection' && entry.level === LogLevel.WARN) {
        warnings.push(entry.message);
      }
    });
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const otherParent = new THREE.Group();
    otherParent.position.set(5, 0, 0);
    const holder = new THREE.Group();
    group.add(otherParent, holder);
    const removed = new THREE.Object3D();
    const reparented = new THREE.Object3D();
    const viaHolder = new THREE.Object3D();
    group.add(removed, reparented);
    holder.add(viaHolder);
    registry.track(removed);
    registry.track(reparented);
    registry.track(viaHolder);
    group.remove(removed);
    otherParent.add(reparented);
    for (const o of [removed, reparented]) {
      expect(registry.entryOf(o)).toBeUndefined();
      expect(poseCommitterOf(o)).toBeNull();
    }
    group.remove(holder); // the object keeps its parent, the parent left
    store.dispatch(
      relocalizationObserved(
        jumpObservation(1000, { position: [3, 0, 0], rotation: [0, 0, 0, 1] })
      )
    );
    for (const o of [removed, reparented, viaHolder]) {
      expect(o.position.toArray()).toEqual([0, 0, 0]);
      expect(registry.entryOf(o)).toBeUndefined();
      expect(poseCommitterOf(o)).toBeNull();
    }
    expect(warnings).toHaveLength(1);
    unsubscribe();
  });

  it('a tile cache that evicts with remove() leaves no entry, claim or listener behind', () => {
    // Why this test matters: a first-in first-out tile cache under the
    // basis node removes old tiles and never calls untrack; each evicted
    // tile must be released at the removal, and tracking the same object
    // again must not stack a second removal listener.
    const store = newStore();
    const group = new THREE.Group();
    const basis = new THREE.Group();
    group.add(basis);
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const removedListeners = (o: THREE.Object3D): number =>
      (
        (o as unknown as { _listeners?: Record<string, unknown[]> })._listeners
          ?.removed ?? []
      ).length;
    const tiles = Array.from({ length: 5 }, () => new THREE.Object3D());
    for (const tile of tiles) {
      basis.add(tile);
      registry.track(tile);
      registry.track(tile); // a restart reuses the listener
      expect(removedListeners(tile)).toBe(1);
    }
    for (const tile of tiles.slice(0, 3)) basis.remove(tile);
    for (const tile of tiles.slice(0, 3)) {
      expect(registry.entryOf(tile)).toBeUndefined();
      expect(poseCommitterOf(tile)).toBeNull();
      expect(removedListeners(tile)).toBe(0);
    }
    registry.untrack(tiles[3]!);
    expect(removedListeners(tiles[3]!)).toBe(0);
    registry.dispose();
    expect(removedListeners(tiles[4]!)).toBe(0);
  });

  it('a hint given after tracking re-dates the placement exactly, even after a jump in between', () => {
    // Why this test matters: an app may learn the capture time of a pose
    // only after it added the object. If a jump lands in between, the
    // object already holds that jump; re-tracking must apply only the
    // jumps it is still missing (or take back one it should not have),
    // never apply one twice.
    const store = newStore();
    const group = new THREE.Group();
    const registry = createArSpaceCorrectionRegistry({ group });
    registry.attach(store);
    const step = (t: number, x: number, yaw: number) =>
      store.dispatch(
        relocalizationObserved(
          jumpObservation(t, {
            position: [x, 0, 0.5],
            rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
          })
        )
      );
    step(1000, 1, 0.2); // J0
    const placed = new THREE.Matrix4().compose(
      new THREE.Vector3(2, 0.3, -1),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    const late = new THREE.Object3D();
    placed.decompose(late.position, late.quaternion, late.scale);
    group.add(late);
    registry.track(late); // epoch 1, before the hint is known
    step(2000, -2, -0.3); // J1, received
    // The pose was captured before J0: it needs J0 too, applied before J1.
    registry.track(late, { capturedAt: 500 });
    const d = selectCorrectionTrack(store.getState());
    const want = matrixOfPose(d[0]!).multiply(placed);
    expect(maxDiff(localOf(late), want.toArray())).toBeLessThan(1e-9);
    expect(registry.entryOf(late)).toMatchObject({ start: 0, stampedAt: 500 });
    // Re-dating to a later capture takes J0 back again.
    registry.track(late, { capturedAt: 1500 });
    expect(
      maxDiff(localOf(late), matrixOfPose(d[1]!).multiply(placed).toArray())
    ).toBeLessThan(1e-9);
    // The same hint twice changes nothing.
    const before = localOf(late);
    registry.track(late, { capturedAt: 1500 });
    expect(maxDiff(localOf(late), before)).toBe(0);
    registry.dispose();
  });
});
