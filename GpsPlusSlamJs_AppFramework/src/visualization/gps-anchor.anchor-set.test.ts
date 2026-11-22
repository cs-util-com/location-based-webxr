/**
 * Tests for `createGpsAnchor` as a member of the anchor set
 * (`ar/deferred-anchors.ts`).
 *
 * Why these tests matter: a GPS anchor in `'snap-when-offscreen'` mode must
 * never move while any of it can be seen, at its current pose or at the
 * pose it would jump to, and it must land where scene-root content of the
 * same GPS point lands, also when the world group carries more than the
 * caller's alignment (the dev world jump). The set gives it the same gate,
 * release and frame-switch window as the deferred anchors; each case below
 * pins one of those rules. The camera sits where an app has it: under the
 * WebXR to NUE basis node and the AR pose node inside the world group.
 */
import '../test-setup';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGpsAnchor, type GpsAnchorOptions } from './gps-anchor.js';
import { enableArWorldGroupAlignment } from './ar-world-group-alignment.js';
import { calcRelativeCoordsInMeters, type LatLong } from '../core/index.js';
import {
  __resetAnchorReleaseForTests,
  requestAnchorRelease,
} from '../ar/anchor-release.js';
import { deferredAnchor } from '../ar/deferred-anchors.js';
import { getArParentBinding } from '../ar/ar-parent-target.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from '../ar/session-disposers.js';
import type { SubscribableStore } from '../state/subscribe-to-selector.js';

const DT = 1 / 20;
const ZERO: LatLong = { lat: 47, lon: 8 };

let pointSeq = 0;
function deviceFixes(spanM: number) {
  return [0, spanM].map((n) => ({
    id: `f${(pointSeq += 1)}`,
    timestamp: pointSeq,
    coordinates: [n, 0, 0] as [number, number, number],
  }));
}

/** A store with just what the binding reads; its alignment is `alignment()`. */
function makeStore(extentM: number) {
  const listeners = new Set<() => void>();
  let alignment: number[] = new THREE.Matrix4().toArray();
  const positions = deviceFixes(extentM);
  let epoch = 0;
  const build = () => ({
    gpsData: {
      zero: ZERO,
      gpsEvents: { alignmentMatrix: alignment, gpsPositions: positions },
    },
    qrDetected: { frameEpoch: epoch },
  });
  let state = build();
  const emit = () => {
    state = build();
    for (const l of [...listeners]) l();
  };
  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    alignment: () => alignment,
    setT(m: THREE.Matrix4) {
      alignment = m.toArray();
      emit();
    },
    bumpEpoch() {
      epoch += 1;
      emit();
    },
  } as unknown as SubscribableStore & {
    alignment(): readonly number[];
    setT(m: THREE.Matrix4): void;
    bumpEpoch(): void;
  };
}

/** T: `north`, then `east` metres, after a yaw of `yawDeg`. */
function tOf(north: number, yawDeg = 0, east = 0): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(north, 0, east)
    .multiply(
      new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg))
    );
}

/** The GPS point whose NUE is (`north`, 0, `east`). */
function gpsAt(north: number, east = 0): LatLong {
  return { lat: ZERO.lat + north / 111319, lon: ZERO.lon + east / 75900 };
}

function nueOf(point: LatLong): THREE.Vector3 {
  const n = calcRelativeCoordsInMeters(ZERO, point, 0, 0);
  return new THREE.Vector3(n[0], n[1], n[2]);
}

/**
 * A world group, its binding when `bound`, and a camera at group-local
 * (0, 0, 8) under the real basis and pose nodes. `look('in')` faces the
 * group origin (group-local -z), `look('out')` faces away (+z).
 */
function rig(opts: { bound?: boolean; mature?: boolean } = {}) {
  const store = makeStore(opts.mature === false ? 20 : 40);
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  if (opts.bound !== false) {
    enableArWorldGroupAlignment({ store, arWorldGroup: group });
  }
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const basis = new THREE.Group();
  basis.matrix.copy(WEBXR_TO_NUE);
  basis.matrixAutoUpdate = false;
  const arpose = new THREE.Object3D();
  group.add(basis);
  basis.add(arpose);
  arpose.add(camera);
  const look = (mode: 'in' | 'out'): void => {
    new THREE.Matrix4()
      .compose(
        new THREE.Vector3(0, 0, 8),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          mode === 'in' ? 0 : Math.PI
        ),
        new THREE.Vector3(1, 1, 1)
      )
      .premultiply(basis.matrix.clone().invert())
      .decompose(camera.position, camera.quaternion, camera.scale);
  };
  look('in');
  let t = 0;
  let anchor: ReturnType<typeof createGpsAnchor> | null = null;
  return {
    store,
    group,
    camera,
    look,
    /**
     * A `skipBootstrap` anchor of `object` at `gpsPoint`. The default object
     * is a small mesh that starts 50 m above the group origin, out of view,
     * so its first placement (exempt from the gate) is a real move: an
     * anchor already at its target keeps that exemption armed until it
     * first moves.
     */
    anchor(
      gpsPoint: LatLong,
      overrides: Partial<GpsAnchorOptions> = {},
      object: THREE.Object3D = startAbove(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.2),
          new THREE.MeshBasicMaterial()
        )
      )
    ) {
      if (!object.parent) group.add(object);
      anchor = createGpsAnchor({
        object3D: object,
        arWorldGroup: group,
        camera,
        gpsPoint,
        skipBootstrap: true,
        mode: 'snap-when-offscreen',
        getAlignmentMatrix: () => store.alignment(),
        getGpsZeroRef: () => ZERO,
        ...overrides,
      });
      return { anchor, object };
    },
    /** `n` frames: the binding's step, then the set's pass. */
    run(n = 1) {
      for (let i = 0; i < n; i += 1) {
        anchor?.__tickForTests(DT, t);
        t += DT;
      }
    },
    runUntil(untilS: number) {
      while (t < untilS - 1e-9) this.run();
    },
  };
}

function startAbove(object: THREE.Object3D): THREE.Object3D {
  object.position.set(0, 50, 0);
  return object;
}

function worldOf(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

beforeEach(() => {
  __resetAnchorReleaseForTests();
});

afterEach(() => {
  runSessionDisposers();
  clearSessionDisposers();
  clearFrameUpdates();
  __resetAnchorReleaseForTests();
});

describe('createGpsAnchor in the anchor set: the view gate', () => {
  it('does not move while only a child of the object is in view', () => {
    // The object's own origin is behind the camera; its child mesh is in
    // front of it. Seen content must not jump, so the whole object waits.
    const r = rig();
    r.store.setT(tOf(0, 0, -12)); // the object at group-local z = 12
    const object = new THREE.Group();
    const child = new THREE.Mesh(
      new THREE.SphereGeometry(0.2),
      new THREE.MeshBasicMaterial()
    );
    child.position.set(0, 0, -10); // group-local z = 2: in view
    object.add(child);
    r.group.add(object);
    r.run(2);
    const { object: o } = r.anchor(ZERO, {}, object);
    r.run(2); // first placement (exempt)
    const placed = o.position.clone();
    expect(placed.z).toBeCloseTo(12, 6);

    // The target 50 m to the side: the child would sit at (50, 0, 2), out
    // of view in either direction, so only its current pose blocks.
    r.store.setT(tOf(-50, 0, -12));
    r.run(6);
    expect(o.position.distanceTo(placed)).toBeLessThan(1e-9);

    r.look('out'); // now the child (z = 2) is behind the camera
    r.run(6);
    expect(o.position.x).toBeCloseTo(50, 6);
    expect(o.position.z).toBeCloseTo(12, 6);
  });

  it('does not move while the pose it would jump to is in view', () => {
    // Current pose behind the camera, target pose in front of it: the
    // object would appear in view at its new pose, which is a visible jump.
    const r = rig();
    r.store.setT(tOf(0, 0, -12));
    r.run(2);
    const { object } = r.anchor(ZERO);
    r.run(2);
    expect(object.position.z).toBeCloseTo(12, 6);

    r.store.setT(new THREE.Matrix4()); // target at the origin: in view
    r.run(6);
    expect(object.position.z).toBeCloseTo(12, 6);

    r.look('out'); // origin behind, z = 12 in front: current pose in view
    r.run(6);
    expect(object.position.z).toBeCloseTo(12, 6);
  });

  it('in, out, in gives no commit; out for two passes commits', () => {
    const r = rig();
    r.run(2);
    const { object } = r.anchor(ZERO);
    r.run(2);
    r.store.setT(tOf(6)); // target group-local (-6, 0, 0), beside the origin
    r.run(1);
    r.look('out');
    r.run(1);
    r.look('in');
    r.run(3);
    expect(object.position.length()).toBeLessThan(1e-9);
    r.look('out');
    r.run(3);
    expect(object.position.x).toBeCloseTo(-6, 6);
  });

  it('keeps the distance-scaled threshold as its pending rule', () => {
    // Camera 8 m away: threshold 2 m x 1.8 = 3.6 m. A 3 m step out of view
    // stays put, a 5 m step lands.
    const r = rig();
    r.run(2);
    r.look('out');
    const { object } = r.anchor(ZERO);
    r.run(2);
    r.store.setT(tOf(3));
    r.run(6);
    expect(object.position.length()).toBeLessThan(1e-9);
    r.store.setT(tOf(5));
    r.run(6);
    expect(object.position.x).toBeCloseTo(-5, 6);
  });

  it('snap-every-tick is not gated by the view', () => {
    const r = rig();
    r.run(2);
    const { object } = r.anchor(ZERO, { mode: 'snap-every-tick' });
    r.run(2);
    r.store.setT(tOf(5));
    r.run(1);
    expect(object.position.x).toBeCloseTo(-5, 6);
  });

  it('defers in view while the alignment is immature (it takes no follow phase)', () => {
    const r = rig({ mature: false });
    r.run(2);
    const { object } = r.anchor(ZERO);
    r.run(2);
    r.store.setT(tOf(5));
    r.run(6);
    expect(object.position.length()).toBeLessThan(1e-9);
  });
});

describe('createGpsAnchor in the anchor set: events', () => {
  it('a code-lock release commits it at once, in view and below its threshold', () => {
    const r = rig();
    r.run(2);
    const { object } = r.anchor(ZERO);
    r.run(2);
    r.store.setT(tOf(0.5));
    r.run(4);
    expect(object.position.length()).toBeLessThan(1e-9);
    requestAnchorRelease('code-lock');
    r.run(1);
    expect(worldOf(object).length()).toBeLessThan(1e-9);
    expect(object.position.x).toBeCloseTo(-0.5, 9);
  });

  it('a frame switch lets an above-threshold correction land in view, a smaller one not', () => {
    const r = rig();
    r.run(2);
    const { object } = r.anchor(ZERO);
    r.run(2);
    expect(object.position.length()).toBeLessThan(1e-9); // first placement done
    r.store.bumpEpoch();
    r.store.setT(tOf(5));
    r.run(1);
    expect(object.position.x).toBeCloseTo(-5, 6);
    r.store.setT(tOf(6)); // 1 m more, inside the open window
    r.run(4);
    expect(object.position.x).toBeCloseTo(-5, 6);
  });
});

describe('createGpsAnchor in the anchor set: where the target comes from', () => {
  it('under the binding with a dev world jump, its world position is its NUE', () => {
    // The group carries J.A (the dev jump times the alignment). The target
    // must come from that, not from the caller's A, or the object would sit
    // J away from where scene-root content of the same point sits.
    const g = globalThis as { location?: unknown };
    const before = g.location;
    g.location = { search: '?devWorldJumpM=3&devWorldJumpDeg=10' };
    try {
      const r = rig();
      r.store.setT(tOf(2, 5));
      r.run(2);
      const point = gpsAt(0, 20); // group-local +z side: behind the camera
      const { object } = r.anchor(point, { distanceThreshold: 0.5 });
      r.runUntil(12); // the first jump lands at 10 s
      r.run(10);
      expect(getArParentBinding(r.group)).toBeTruthy();
      const nue = nueOf(point);
      expect(worldOf(object).distanceTo(nue)).toBeLessThan(1e-6);
    } finally {
      g.location = before;
    }
  });

  it("without a binding, it solves the caller's alignment", () => {
    const r = rig({ bound: false });
    expect(getArParentBinding(r.group)).toBeFalsy();
    let alignment: readonly number[] = tOf(1, 20).toArray();
    r.group.matrixAutoUpdate = false;
    r.group.matrix.copy(tOf(40)); // a group matrix the anchor must ignore
    const point = gpsAt(0, 20);
    const { object } = r.anchor(point, {
      getAlignmentMatrix: () => alignment,
      distanceThreshold: 0.5,
    });
    r.run(2);
    const expected = (a: readonly number[]) =>
      nueOf(point).applyMatrix4(new THREE.Matrix4().fromArray(a).invert());
    expect(object.position.distanceTo(expected(alignment))).toBeLessThan(1e-9);
    alignment = tOf(4, 30).toArray();
    r.run(4);
    expect(object.position.distanceTo(expected(alignment))).toBeLessThan(1e-9);
  });
});

describe('createGpsAnchor in the anchor set: nesting', () => {
  it('refuses an anchor whose object holds an already anchored object', () => {
    const r = rig();
    const outer = new THREE.Group();
    const inner = new THREE.Object3D();
    outer.add(inner);
    r.group.add(outer);
    r.anchor(ZERO, {}, inner);
    expect(() => r.anchor(ZERO, {}, outer)).toThrow(/nest/i);
  });

  it('refuses a gps anchor inside a deferred root, and a deferred root holding a gps anchor', () => {
    const r = rig();
    const root = new THREE.Group();
    deferredAnchor(r.group, 'k').add(root);
    const inside = new THREE.Object3D();
    root.add(inside);
    expect(() => r.anchor(ZERO, {}, inside)).toThrow(/nest/i);

    const holder = new THREE.Group();
    const anchored = new THREE.Object3D();
    holder.add(anchored);
    r.group.add(holder);
    r.anchor(ZERO, {}, anchored);
    expect(() => deferredAnchor(r.group, 'h').add(holder)).toThrow(/nest/i);
  });
});
