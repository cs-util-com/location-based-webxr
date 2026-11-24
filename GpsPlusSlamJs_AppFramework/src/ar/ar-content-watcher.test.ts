import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureStore } from '@reduxjs/toolkit';
import {
  arSpaceCorrectionReducer,
  relocalizationObserved,
  type RelocalizationObservation,
} from '../state/ar-space-correction-slice';
import type { Pose } from './qr/qr-pose';
import { enableArSpaceCorrection } from './ar-content-watcher';
import { claimPose, poseCommitterOf, releasePose } from './pose-committer';
import { WEBXR_TO_NUE } from './webxr-nue-basis';

const newStore = () =>
  configureStore({ reducer: { arSpaceCorrection: arSpaceCorrectionReducer } });

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
/** O = B * R: the WebXR-to-NUE basis, the oracle's own copy of the frames. */
const B = WEBXR_TO_NUE;

/** A rigid transform in the raw WebXR frame: a yaw (gravity is known) and a shift. */
const rawRigid = (yaw: number, x: number, y: number, z: number) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    ONE
  );

function poseOf(m: THREE.Matrix4): Pose {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/** An object's local matrix, read the way three.js draws it. */
const localOf = (o: THREE.Object3D): THREE.Matrix4 =>
  o.matrixAutoUpdate
    ? new THREE.Matrix4().compose(o.position, o.quaternion, o.scale)
    : o.matrix.clone();

/** The object's transform in O: the local matrices up to `group`. */
function inGroup(o: THREE.Object3D, group: THREE.Object3D): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (let n: THREE.Object3D | null = o; n !== group; n = n!.parent) {
    m.premultiply(localOf(n!));
  }
  return m;
}

const maxDiff = (a: THREE.Matrix4, b: THREE.Matrix4): number =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i]!)));

function setLocal(o: THREE.Object3D, m: THREE.Matrix4): void {
  m.decompose(o.position, o.quaternion, o.scale);
}

/** An observation whose raw frame switch is `jump`, with a still camera. */
function stillJump(t: number, jump: THREE.Matrix4): RelocalizationObservation {
  const camera = new THREE.Matrix4().makeTranslation(0, 1.5, 0);
  return {
    t,
    tLast: t - 33,
    lastPose: poseOf(camera),
    tPrev: null,
    prevPose: null,
    newPose: poseOf(jump.clone().multiply(camera)),
  };
}

/** The jump `jump` (raw) as it acts in O. */
const inO = (jump: THREE.Matrix4) =>
  B.clone().multiply(jump).multiply(B.clone().invert());

describe('ar-content-watcher', () => {
  it('the coin game: every coin sits on its physical spot after each jump, with no call from the app', () => {
    // Why this test matters: this is the developer's view of the feature
    // (the sidecar's example). A simulated user walks and turns, the raw
    // frame switches twice, and coins placed by hit tests before, between
    // and after the jumps must stay on their floor points as an independent
    // simulation of the frames sees them. A bobbing coin (relative writes),
    // a coin glued to the camera (absolute writes), a coin moved to a new
    // tap, an excluded helper and a coin in a container check every way an
    // app writes a pose.
    const store = newStore();
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });

    // Raw frame of each epoch: raw = G[k] * physical.
    const G = [
      new THREE.Matrix4(),
      rawRigid(0.3, 2, 0, -1),
      rawRigid(-0.5, -1, 0.2, 3),
    ];
    const JUMP_FRAMES = [30, 60];
    const tOf = (f: number) => 1000 + 33 * f;
    /** Physical camera: walking 1.2 m/s, turning 20 deg/s. */
    const camera = (t: number) => {
      const s = (t - 1000) / 1000;
      return new THREE.Matrix4().compose(
        new THREE.Vector3(1.2 * s, 1.5, -0.3 * s),
        new THREE.Quaternion().setFromAxisAngle(
          UP,
          THREE.MathUtils.degToRad(20) * s
        ),
        ONE
      );
    };
    let k = 0;
    const rawCamera = (t: number, epoch = k) =>
      G[epoch]!.clone().multiply(camera(t));
    /** A hit test on physical floor point `p`: its pose in O now. */
    const hit = (p: [number, number, number]) =>
      B.clone()
        .multiply(G[k]!)
        .multiply(new THREE.Matrix4().makeTranslation(...p));
    /** Where a physical point must be in O after the jumps seen so far. */
    const expectedAt = (p: [number, number, number]) => hit(p);

    const floor = {
      a: [1, 0, -2],
      b: [3, 0, -1],
      c: [-2, 0, -4],
      moved1: [0.5, 0, -1.5],
      moved2: [2.5, 0, -3],
      bob: [-1, 0, -2],
      inBox: [4, 0, -2],
    } as const satisfies Record<string, [number, number, number]>;

    const coins = arCorrection.container(new THREE.Group());
    setLocal(coins, rawRigid(0.25, 0.5, 0, 0.2));
    const helper = new THREE.Object3D();
    helper.position.set(0, 0.1, 0);
    arCorrection.exclude(helper);
    const helperLocal = localOf(helper);
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    const c = new THREE.Object3D();
    const moved = new THREE.Object3D();
    const bob = new THREE.Object3D();
    const glued = new THREE.Object3D();
    const inBox = new THREE.Object3D();
    const GLUE = new THREE.Matrix4().makeTranslation(0, 0, -0.5);
    let bobOffset = 0;

    const check = (t: number) => {
      const placed: Array<[THREE.Object3D, readonly [number, number, number]]> =
        [
          [a, floor.a],
          [b, floor.b],
          [c, floor.c],
          [inBox, floor.inBox],
        ];
      for (const [coin, p] of placed) {
        if (coin.parent === null) continue;
        expect(
          maxDiff(inGroup(coin, arWorldGroup), expectedAt([...p]))
        ).toBeLessThan(1e-9);
      }
      const movedAt = t >= tOf(45) ? floor.moved2 : floor.moved1;
      expect(
        moved.parent === null
          ? 0
          : maxDiff(inGroup(moved, arWorldGroup), expectedAt([...movedAt]))
      ).toBeLessThan(1e-9);
      const bobExpected = new THREE.Matrix4()
        .makeTranslation(0, bobOffset, 0)
        .multiply(expectedAt([...floor.bob]));
      expect(maxDiff(inGroup(bob, arWorldGroup), bobExpected)).toBeLessThan(
        1e-9
      );
      const gluedExpected = B.clone().multiply(rawCamera(t)).multiply(GLUE);
      expect(maxDiff(inGroup(glued, arWorldGroup), gluedExpected)).toBeLessThan(
        1e-9
      );
      expect(maxDiff(localOf(helper), helperLocal)).toBe(0);
    };

    for (let f = 0; f <= 90; f++) {
      const t = tOf(f);
      // The feed dispatches the observation before the frame's other readers.
      const jumpIndex = JUMP_FRAMES.indexOf(f);
      if (jumpIndex >= 0) {
        const before = k;
        k = jumpIndex + 1;
        const toPose = (m: THREE.Matrix4) => poseOf(m);
        store.dispatch(
          relocalizationObserved({
            t,
            tLast: tOf(f - 1),
            lastPose: toPose(rawCamera(tOf(f - 1), before)),
            // The baseline as the feed picks it: the newest frame at
            // least 100 ms before tLast (four 33 ms frames back).
            tPrev: tOf(f - 5),
            prevPose: toPose(rawCamera(tOf(f - 5), before)),
            newPose: toPose(rawCamera(t)),
          })
        );
      }
      if (f === 0) {
        arContent.add(coins, helper, bob, glued);
        setLocal(bob, hit(floor.bob));
      }
      if (f === 10) {
        setLocal(a, hit(floor.a));
        setLocal(moved, hit(floor.moved1));
        arContent.add(a, moved);
      }
      if (f === 40) {
        setLocal(b, hit(floor.b));
        arContent.add(b);
      }
      if (f === 45) setLocal(moved, hit(floor.moved2)); // a new tap
      if (f === 50) {
        // An item collected into the container after a jump: its local
        // pose is the tap expressed in the container's frame.
        setLocal(
          inBox,
          inGroup(coins, arWorldGroup).invert().multiply(hit(floor.inBox))
        );
        coins.add(inBox);
      }
      if (f === 70) {
        setLocal(c, hit(floor.c));
        arContent.add(c);
      }
      // The app's own per-frame writes.
      const dy = 0.002 * Math.sin(f / 5);
      bob.position.y += dy;
      bobOffset += dy;
      setLocal(glued, B.clone().multiply(rawCamera(t)).multiply(GLUE));
      check(t);
    }
    // The container itself never moved; the helper never moved.
    expect(maxDiff(localOf(coins), rawRigid(0.25, 0.5, 0, 0.2))).toBeLessThan(
      1e-12
    );
    expect(poseCommitterOf(coins)).toBeNull();
    expect(poseCommitterOf(helper)).toBeNull();
    arCorrection.dispose();
  });

  it('a capturedAt hint gives exactly the jumps after the capture, before or after the add', () => {
    // Why this test matters: content computed from older data (an async
    // tile, a worker result) is added after a jump it has not seen; the
    // hint must apply the missed jumps once, and the same whichever order
    // the app calls track and add in.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    const J1 = rawRigid(0.2, 3, 0, 0);
    const J2 = rawRigid(-0.4, 0, 0, 2);
    store.dispatch(relocalizationObserved(stillJump(1000, J1)));
    store.dispatch(relocalizationObserved(stillJump(2000, J2)));
    const given = rawRigid(0.7, 1, 0, -2);
    const afterCapture = inO(J2).multiply(given);

    const hintFirst = new THREE.Object3D();
    setLocal(hintFirst, given);
    arCorrection.track(hintFirst, { capturedAt: 1500 });
    expect(hintFirst.position.toArray()).toEqual(poseOf(given).position);
    arContent.add(hintFirst);

    const addFirst = new THREE.Object3D();
    setLocal(addFirst, given);
    arContent.add(addFirst);
    arCorrection.track(addFirst, { capturedAt: 1500 });

    // A hint for an item inside a container that is added later.
    const box = arCorrection.container(new THREE.Group());
    const inBox = new THREE.Object3D();
    setLocal(inBox, given);
    box.add(inBox);
    arCorrection.track(inBox, { capturedAt: 1500 });
    arContent.add(box);

    for (const o of [hintFirst, addFirst, inBox]) {
      expect(maxDiff(localOf(o), afterCapture)).toBeLessThan(1e-9);
    }
    // Before both jumps: their product, the later one on the left.
    const early = new THREE.Object3D();
    setLocal(early, given);
    arCorrection.track(early, { capturedAt: 500 });
    arContent.add(early);
    expect(
      maxDiff(localOf(early), inO(J2).multiply(inO(J1)).multiply(given))
    ).toBeLessThan(1e-9);
    // After both: nothing.
    const late = new THREE.Object3D();
    setLocal(late, given);
    arCorrection.track(late, { capturedAt: 2000 });
    arContent.add(late);
    expect(maxDiff(localOf(late), given)).toBeLessThan(1e-12);
    // A hint is used once: re-adding is a new placement at the current epoch.
    arContent.remove(hintFirst);
    const kept = localOf(hintFirst);
    arContent.add(hintFirst);
    expect(maxDiff(localOf(hintFirst), kept)).toBe(0);
    expect(() => arCorrection.track(late, { capturedAt: Number.NaN })).toThrow(
      TypeError
    );
    expect(() => arCorrection.track(late, { capturedAt: 1, epoch: 0 })).toThrow(
      TypeError
    );
    arCorrection.dispose();
  });

  it('arcorrected fires once per corrected object per jump, carrying the applied M; never for excluded objects or containers', () => {
    // Why this test matters: a physics body or the app's own copy of a
    // position follows the bake through this event; a missing event leaves
    // it behind, a doubled one has it apply the jump twice.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    const box = arCorrection.container(new THREE.Group());
    box.position.set(1, 0, 0);
    box.rotation.y = 0.5;
    const helper = new THREE.Object3D();
    arCorrection.exclude(helper);
    const coin = new THREE.Object3D();
    coin.position.set(0, 0, -2);
    const item = new THREE.Object3D();
    item.position.set(0.5, 0, 0);
    box.add(item);
    arContent.add(coin, box, helper);
    const events = new Map<THREE.Object3D, Array<readonly number[]>>();
    // The pose a listener reads inside the event: it must already be baked.
    const seen = new Map<THREE.Object3D, THREE.Matrix4[]>();
    const before = new Map<THREE.Object3D, THREE.Matrix4>();
    for (const o of [coin, item, box, helper]) {
      events.set(o, []);
      seen.set(o, []);
      o.addEventListener('arcorrected', (e) => {
        events.get(o)!.push(e.matrix);
        seen.get(o)!.push(localOf(o));
      });
    }
    for (const [i, t] of [1000, 2000].entries()) {
      for (const o of [coin, item]) before.set(o, localOf(o));
      store.dispatch(
        relocalizationObserved(stillJump(t, rawRigid(0.3, 2, 0, 1)))
      );
      for (const o of [coin, item]) {
        const got = events.get(o)!;
        expect(got).toHaveLength(i + 1);
        const m = new THREE.Matrix4().fromArray([...got[i]!]);
        const want = m.multiply(before.get(o)!);
        expect(maxDiff(localOf(o), want)).toBeLessThan(1e-9);
        expect(maxDiff(seen.get(o)![i]!, want)).toBeLessThan(1e-9);
        expect(Object.isFrozen(got[i])).toBe(true);
      }
    }
    // Siblings share one M per jump, directly under arContent and inside
    // one container: the correction is prepared once per parent object,
    // not once per item (the bake's cost at 1,000 items rests on it).
    const twin = new THREE.Object3D();
    arContent.add(twin);
    const boxTwin = new THREE.Object3D();
    box.add(boxTwin);
    const twinEvents: Array<readonly number[]> = [];
    twin.addEventListener('arcorrected', (e) => twinEvents.push(e.matrix));
    const boxTwinEvents: Array<readonly number[]> = [];
    boxTwin.addEventListener('arcorrected', (e) =>
      boxTwinEvents.push(e.matrix)
    );
    store.dispatch(
      relocalizationObserved(stillJump(3000, rawRigid(0.1, 1, 0, 0)))
    );
    expect(twinEvents).toHaveLength(1);
    expect(twinEvents[0]).toBe(events.get(coin)![2]);
    expect(boxTwinEvents).toHaveLength(1);
    expect(boxTwinEvents[0]).toBe(events.get(item)![2]);
    expect(boxTwinEvents[0]).not.toBe(twinEvents[0]);
    store.dispatch({ type: 'unrelated/action' });
    expect(events.get(coin)).toHaveLength(3);
    expect(events.get(box)).toEqual([]);
    expect(events.get(helper)).toEqual([]);
    arCorrection.dispose();
  });

  it('a container moved after its items were added carries them, and the next jump lands them on their physical spot', () => {
    // Why this test matters: a chest that collects coins may be carried
    // to a new place (and turned). Each jump must read the chest where it
    // is now; a transform remembered from the add misplaces every coin in
    // it by the chest's move turned through the jump (metres for a 90 deg
    // turn and a 3 m jump).
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    const chest = arCorrection.container(new THREE.Group());
    chest.position.set(1, 0, -1);
    arContent.add(chest);
    const coin = new THREE.Object3D();
    coin.position.set(0.3, 0.1, 0);
    chest.add(coin);
    // Carried 10 m and turned a quarter.
    chest.position.set(-6, 0, 7);
    chest.rotation.y = Math.PI / 2;
    const placedInO = inGroup(coin, arWorldGroup);
    const J = rawRigid(Math.PI / 2, 3, 0, 0);
    store.dispatch(relocalizationObserved(stillJump(1000, J)));
    expect(
      maxDiff(inGroup(coin, arWorldGroup), inO(J).multiply(placedInO))
    ).toBeLessThan(1e-9);
    // The chest itself never moves with the correction.
    expect(chest.position.toArray()).toEqual([-6, 0, 7]);
    arCorrection.dispose();
  });

  it('content added while no store is attached keeps its hint and is tracked at the next attach', () => {
    // Why this test matters: between a recording's detach and the next
    // store, the app keeps placing content. An add must not throw, and the
    // hint it was given must not be lost.
    const first = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store: first,
      arWorldGroup,
    });
    const detach = arCorrection.attach(first);
    detach();
    const second = newStore();
    const J0 = rawRigid(0.2, 1, 0, 0);
    second.dispatch(relocalizationObserved(stillJump(1000, J0)));
    const hinted = new THREE.Object3D();
    hinted.position.set(1, 0, 0);
    arCorrection.track(hinted, { capturedAt: 500 }); // before J0
    const plain = new THREE.Object3D();
    plain.position.set(0, 0, -1);
    expect(() => arContent.add(hinted, plain)).not.toThrow();
    const box = arCorrection.container(new THREE.Group());
    const inBox = new THREE.Object3D();
    box.add(inBox);
    arContent.add(box);
    for (const o of [hinted, plain, inBox]) {
      expect(poseCommitterOf(o)).toBeNull();
    }
    const hintedAt = localOf(hinted);
    const plainAt = localOf(plain);
    arCorrection.attach(second);
    // The hint dates the pose before J0: J0 is applied at the attach.
    expect(maxDiff(localOf(hinted), inO(J0).multiply(hintedAt))).toBeLessThan(
      1e-9
    );
    expect(maxDiff(localOf(plain), plainAt)).toBe(0);
    for (const o of [hinted, plain, inBox]) {
      expect(poseCommitterOf(o)).toBe('AR-space correction');
    }
    arCorrection.dispose();
  });

  it('one child that cannot be tracked does not stop its siblings when a container with children is added', () => {
    // Why this test matters: a container added with many items, one of
    // which another committer owns, must still track the rest; the failure
    // is thrown out of add after all siblings were placed.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    const box = arCorrection.container(new THREE.Group());
    const items = Array.from({ length: 4 }, () => new THREE.Object3D());
    box.add(...items);
    claimPose(items[1]!, 'deferred anchor');
    expect(() => arContent.add(box)).toThrow(/deferred anchor/);
    expect(items.map((o) => poseCommitterOf(o))).toEqual([
      'AR-space correction',
      'deferred anchor',
      'AR-space correction',
      'AR-space correction',
    ]);
    releasePose(items[1]!, 'deferred anchor');
    arCorrection.dispose();
  });

  it('attach keeps its detach function when content added while detached cannot be tracked', () => {
    // Why this test matters: the add that placed the content returned long
    // ago, so a failure at attach has no caller to reach. Thrown out of
    // attach, it would leave the store subscribed with its detach function
    // lost; it is logged instead, and the other content is still tracked.
    const first = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store: first,
      arWorldGroup,
    });
    arCorrection.attach(first)();
    const owned = new THREE.Object3D();
    const free = new THREE.Object3D();
    arContent.add(owned, free);
    claimPose(owned, 'deferred anchor'); // claimed while waiting
    const second = newStore();
    let detach: (() => void) | undefined;
    expect(() => {
      detach = arCorrection.attach(second);
    }).not.toThrow();
    expect(poseCommitterOf(owned)).toBe('deferred anchor');
    expect(poseCommitterOf(free)).toBe('AR-space correction');
    // The detach function works: a jump after it moves nothing.
    const freeAt = localOf(free);
    detach!();
    second.dispatch(
      relocalizationObserved(stillJump(1000, rawRigid(0.3, 2, 0, 0)))
    );
    expect(maxDiff(localOf(free), freeAt)).toBe(0);
    releasePose(owned, 'deferred anchor');
    arCorrection.dispose();
  });

  it('untrack of content added while detached keeps it out at the next attach', () => {
    // Why this test matters: untrack is the app's way to take an object
    // back; it must hold for content still waiting for a store too, or the
    // next attach claims and corrects an object the app manages itself.
    const first = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store: first,
      arWorldGroup,
    });
    arCorrection.attach(first)();
    const mine = new THREE.Object3D();
    arContent.add(mine);
    arCorrection.untrack(mine);
    const second = newStore();
    arCorrection.attach(second);
    expect(poseCommitterOf(mine)).toBeNull();
    const at = localOf(mine);
    second.dispatch(
      relocalizationObserved(stillJump(1000, rawRigid(0.3, 2, 0, 0)))
    );
    expect(maxDiff(localOf(mine), at)).toBe(0);
    arCorrection.dispose();
  });

  it('a store swap keeps every pose and the next jump is applied exactly once', () => {
    // Why this test matters: a second recording in the same AR session
    // brings a new store whose epoch starts again at zero.
    const first = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store: first,
      arWorldGroup,
    });
    const coin = new THREE.Object3D();
    arContent.add(coin);
    first.dispatch(
      relocalizationObserved(stillJump(1000, rawRigid(0, 3, 0, 0)))
    );
    const afterFirst = localOf(coin);
    const second = newStore();
    arCorrection.attach(second);
    expect(maxDiff(localOf(coin), afterFirst)).toBe(0);
    first.dispatch(
      relocalizationObserved(stillJump(2000, rawRigid(0, 5, 0, 0)))
    );
    expect(maxDiff(localOf(coin), afterFirst)).toBe(0);
    const J = rawRigid(0.2, 0, 0, 1);
    second.dispatch(relocalizationObserved(stillJump(500, J)));
    expect(maxDiff(localOf(coin), inO(J).multiply(afterFirst))).toBeLessThan(
      1e-9
    );
    // Content added after the swap is tracked against the second store.
    const late = new THREE.Object3D();
    arContent.add(late);
    second.dispatch(relocalizationObserved(stillJump(600, J)));
    expect(maxDiff(localOf(late), inO(J))).toBeLessThan(1e-9);
    arCorrection.dispose();
  });

  describe('contract pins', () => {
    it('an InstancedMesh moves as one object; its instances are untouched', () => {
      // Why this test matters: instances placed in different epochs cannot
      // be corrected apart; the sidecar tells apps to split such content
      // per segment, and this pins that the watcher never edits instances.
      const store = newStore();
      const arWorldGroup = new THREE.Group();
      const { arContent } = enableArSpaceCorrection({ store, arWorldGroup });
      const mesh = new THREE.InstancedMesh(
        new THREE.BufferGeometry(),
        undefined,
        3
      );
      for (let i = 0; i < 3; i++) {
        mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 0, 0));
      }
      const instances = [...mesh.instanceMatrix.array];
      arContent.add(mesh);
      const J = rawRigid(0.4, 1, 0, 2);
      store.dispatch(relocalizationObserved(stillJump(1000, J)));
      expect([...mesh.instanceMatrix.array]).toEqual(instances);
      expect(maxDiff(localOf(mesh), inO(J))).toBeLessThan(1e-9);
    });

    it('an object an anchor commits cannot be added to arContent, and a tracked one cannot be anchored', () => {
      // Why this test matters: the one-committer rule holds through the
      // watcher too, so an anchored object never receives a jump twice.
      const store = newStore();
      const arWorldGroup = new THREE.Group();
      const { arContent, arCorrection } = enableArSpaceCorrection({
        store,
        arWorldGroup,
      });
      const anchored = new THREE.Object3D();
      claimPose(anchored, 'deferred anchor');
      expect(() => arContent.add(anchored)).toThrow(/deferred anchor/);
      releasePose(anchored, 'deferred anchor');
      const coin = new THREE.Object3D();
      arContent.add(coin);
      expect(poseCommitterOf(coin)).toBe('AR-space correction');
      expect(() => claimPose(coin, 'GPS anchor')).toThrow(
        /AR-space correction/
      );
      arContent.remove(coin);
      expect(poseCommitterOf(coin)).toBeNull();
      claimPose(coin, 'GPS anchor');
      releasePose(coin, 'GPS anchor');
      arCorrection.dispose();
    });

    it('content added to arWorldGroup directly is not touched; arContent itself never moves', () => {
      // Why this test matters: the framework's own children of the world
      // group (anchors, tile and occupancy nodes) stay out by placement.
      const store = newStore();
      const arWorldGroup = new THREE.Group();
      const { arContent } = enableArSpaceCorrection({ store, arWorldGroup });
      expect(arContent.parent).toBe(arWorldGroup);
      const direct = new THREE.Object3D();
      direct.position.set(1, 2, 3);
      arWorldGroup.add(direct);
      store.dispatch(
        relocalizationObserved(stillJump(1000, rawRigid(0.3, 2, 0, 1)))
      );
      expect(direct.position.toArray()).toEqual([1, 2, 3]);
      expect(maxDiff(localOf(arContent), new THREE.Matrix4())).toBe(0);
      expect(poseCommitterOf(direct)).toBeNull();
    });

    it('re-parenting between watched groups is a new placement; out of them untracks; dispose stops everything', () => {
      // Why this test matters: an object the app moves elsewhere must not
      // keep a correction computed for its old parent, and after dispose no
      // listener may move content.
      const store = newStore();
      const arWorldGroup = new THREE.Group();
      const { arContent, arCorrection } = enableArSpaceCorrection({
        store,
        arWorldGroup,
      });
      const box = arCorrection.container(new THREE.Group());
      box.position.set(2, 0, 0);
      arContent.add(box);
      const coin = new THREE.Object3D();
      arContent.add(coin);
      box.attach(coin); // keeps the world pose, new parent
      expect(poseCommitterOf(coin)).toBe('AR-space correction');
      const J = rawRigid(0, 1, 0, 0);
      store.dispatch(relocalizationObserved(stillJump(1000, J)));
      expect(maxDiff(inGroup(coin, arWorldGroup), inO(J))).toBeLessThan(1e-9);
      const outside = new THREE.Group();
      arWorldGroup.add(outside);
      outside.attach(coin);
      expect(poseCommitterOf(coin)).toBeNull();
      // A container removed from arContent lets go of its items.
      const item = new THREE.Object3D();
      box.add(item);
      expect(poseCommitterOf(item)).toBe('AR-space correction');
      arContent.remove(box);
      expect(poseCommitterOf(item)).toBeNull();
      box.add(new THREE.Object3D()); // no longer watched
      expect(poseCommitterOf(box.children[1]!)).toBeNull();
      const kept = new THREE.Object3D();
      arContent.add(kept);
      arCorrection.dispose();
      expect(poseCommitterOf(kept)).toBeNull();
      store.dispatch(relocalizationObserved(stillJump(2000, J)));
      expect(kept.position.toArray()).toEqual([0, 0, 0]);
      const afterDispose = new THREE.Object3D();
      arContent.add(afterDispose);
      expect(poseCommitterOf(afterDispose)).toBeNull();
    });

    it('marking a tracked child as a container untracks it and tracks its children; bad calls throw', () => {
      // Why this test matters: a group the app turns into a container after
      // adding it must stop carrying corrections itself, or its items would
      // receive each jump twice.
      const store = newStore();
      const arWorldGroup = new THREE.Group();
      const { arContent, arCorrection } = enableArSpaceCorrection({
        store,
        arWorldGroup,
      });
      const group = new THREE.Group();
      const item = new THREE.Object3D();
      group.add(item);
      arContent.add(group);
      expect(poseCommitterOf(group)).toBe('AR-space correction');
      expect(arCorrection.container(group)).toBe(group);
      expect(poseCommitterOf(group)).toBeNull();
      expect(poseCommitterOf(item)).toBe('AR-space correction');
      expect(() => arCorrection.track(group)).toThrow(TypeError);
      expect(() => arCorrection.exclude(group)).toThrow(TypeError);
      const helper = new THREE.Object3D();
      arCorrection.exclude(helper);
      expect(() => arCorrection.track(helper)).toThrow(TypeError);
      expect(() => arCorrection.container(helper)).toThrow(TypeError);
      expect(() => arCorrection.track({} as THREE.Object3D)).toThrow(TypeError);
      expect(() =>
        enableArSpaceCorrection({ store, arWorldGroup: {} as THREE.Object3D })
      ).toThrow(TypeError);
      expect(() =>
        enableArSpaceCorrection({
          store: {} as ReturnType<typeof newStore>,
          arWorldGroup,
        })
      ).toThrow(TypeError);
      arCorrection.dispose();
    });
  });
});

describe('ar-content-watcher: arContent, re-adds and detached hints', () => {
  it('arContent is the root container: track and exclude throw a TypeError, container is a no-op', () => {
    // Why this test matters: tracking arContent itself would claim it, and
    // every later arContent.add would then throw a nested-committer error.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    expect(() => arCorrection.track(arContent)).toThrow(TypeError);
    expect(() => arCorrection.exclude(arContent)).toThrow(TypeError);
    expect(arCorrection.container(arContent)).toBe(arContent);
    expect(poseCommitterOf(arContent)).toBeNull();
    const coin = new THREE.Object3D();
    expect(() => arContent.add(coin)).not.toThrow();
    expect(poseCommitterOf(coin)).toBe('AR-space correction');
    arCorrection.dispose();
  });

  it('a child put back by its own removed listener stays corrected', () => {
    // Why this test matters: childremoved fires after the child's removed
    // listeners; when one of them re-added the child, the watcher must not
    // untrack the new placement.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    const coin = new THREE.Object3D();
    let putBack = true;
    coin.addEventListener('removed', () => {
      if (!putBack) return;
      putBack = false;
      arContent.add(coin);
    });
    arContent.add(coin);
    coin.removeFromParent();
    expect(coin.parent).toBe(arContent);
    expect(poseCommitterOf(coin)).toBe('AR-space correction');
    store.dispatch(
      relocalizationObserved(stillJump(1000, rawRigid(0.3, 2, 0, 1)))
    );
    expect(coin.position.length()).toBeGreaterThan(1);
    arCorrection.dispose();
  });

  it('a hint of a child removed while detached is dropped, so its re-add with a new pose gets no old jump', () => {
    // Why this test matters: a re-added object is a new placement; a stale
    // capture-time hint would apply a jump the new pose never missed.
    const store = newStore();
    const arWorldGroup = new THREE.Group();
    const { arContent, arCorrection } = enableArSpaceCorrection({
      store,
      arWorldGroup,
    });
    store.dispatch(
      relocalizationObserved(stillJump(1000, rawRigid(0.3, 2, 0, 1)))
    );
    const detach = arCorrection.attach(store);
    detach();
    const tile = new THREE.Object3D();
    arCorrection.track(tile, { capturedAt: 500 });
    arContent.add(tile);
    arContent.remove(tile);
    tile.position.set(1, 2, 3);
    arContent.add(tile);
    arCorrection.attach(store);
    expect(tile.position.toArray()).toEqual([1, 2, 3]);
    arCorrection.dispose();
  });
});
