/**
 * Property tests for the deferred anchors.
 *
 * Why these tests matter: the unit cases pin one rule each; these run the
 * rules against each other over random sequences of T changes, view
 * changes, frame-epoch bumps, raw camera jumps, code-lock releases and the
 * alignment maturing. The oracle is independent of the set's internals:
 * the camera looks straight at the content or straight away from it, and
 * every T keeps the content well inside (or behind) the view, so whether a
 * root is in view at either pose follows from the look alone.
 *
 * - Safety: while a root is in view (previous or current pass), its local
 *   matrix changes only to put it at its NUE pose (follow, window entry,
 *   first placement) or, at a release, to T^-1; at most once per release.
 * - Liveness: once the alignment is mature, the window closed and the root
 *   out of view, every key lands on T^-1 within k + 2 passes (k keys).
 * - Paths 1 and 2: after convergence the world pose is the NUE pose (the
 *   lerper and the anchors read one T), the dev jump included.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import {
  __resetAnchorReleaseForTests,
  requestAnchorRelease,
} from './anchor-release';
import {
  DEFERRED_ANCHOR_EPSILON_M,
  __runPassForTests,
  deferredAnchor,
} from './deferred-anchors';
import { clearFrameUpdates } from './frame-loop';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from './session-disposers';
import { enableArWorldGroupAlignment } from '../visualization/ar-world-group-alignment';
import type { SubscribableStore } from '../state/subscribe-to-selector';

const DT = 1 / 20;

type Op =
  | { kind: 't'; north: number; east: number; yawDeg: number }
  | { kind: 'look'; dir: 'in' | 'out' }
  | { kind: 'epoch' }
  | { kind: 'jump'; m: number }
  | { kind: 'release' }
  | { kind: 'mature' }
  | { kind: 'idle' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('t' as const),
      north: fc.double({ min: -2, max: 2, noNaN: true }),
      east: fc.double({ min: -2, max: 2, noNaN: true }),
      yawDeg: fc.double({ min: -6, max: 6, noNaN: true }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('look' as const),
      dir: fc.constantFrom('in' as const, 'out' as const),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'epoch' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('jump' as const),
      m: fc.double({ min: 1.2, max: 3, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'release' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'mature' as const }) },
  { weight: 4, arbitrary: fc.constant({ kind: 'idle' as const }) }
);

function tOf(north: number, east: number, yawDeg: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(north, 0, east)
    .multiply(
      new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg))
    );
}

function makeStore(extentM: number) {
  const listeners = new Set<() => void>();
  let alignment = new THREE.Matrix4().toArray();
  let extent = extentM;
  let epoch = 0;
  const build = () => ({
    gpsData: {
      zero: { lat: 47, lon: 8 },
      gpsEvents: {
        alignmentMatrix: alignment,
        gpsPositions: [
          { id: 'a', timestamp: 1, coordinates: [0, 0, 0] },
          { id: 'b', timestamp: 2, coordinates: [extent, 0, 0] },
        ],
      },
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
    setT(m: THREE.Matrix4) {
      alignment = m.toArray();
      emit();
    },
    mature() {
      extent = 40;
      emit();
    },
    bumpEpoch() {
      epoch += 1;
      emit();
    },
  } as unknown as SubscribableStore & {
    setT(m: THREE.Matrix4): void;
    mature(): void;
    bumpEpoch(): void;
  };
}

function maxDiff(a: THREE.Matrix4, b: THREE.Matrix4): number {
  let max = 0;
  for (let i = 0; i < 16; i += 1) {
    max = Math.max(max, Math.abs(a.elements[i]! - b.elements[i]!));
  }
  return max;
}

const IDENTITY = new THREE.Matrix4();

interface Scenario {
  ops: Op[];
  matureAtStart: boolean;
  keys: number;
  devJump: boolean;
}

/** Moves seen across all runs: both kinds must occur, or the safety check is vacuous. */
const seenMoves = { inView: 0, outOfView: 0 };

function runScenario({ ops, matureAtStart, keys, devJump }: Scenario): void {
  const g = globalThis as { location?: unknown };
  const before = g.location;
  g.location = {
    search: devJump ? '?devWorldJumpM=1.5&devWorldJumpDeg=3' : '',
  };
  try {
    const store = makeStore(matureAtStart ? 40 : 20);
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    enableArWorldGroupAlignment({ store, arWorldGroup: group });
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    group.add(camera);
    camera.position.set(0, 0, 40);
    let look: 'in' | 'out' = 'in';
    const setLook = (dir: 'in' | 'out') => {
      look = dir;
      camera.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        dir === 'in' ? 0 : Math.PI
      );
    };
    setLook('in');
    let t = 0;
    const pass = () => {
      const counts = __runPassForTests(group, camera, DT, t);
      t += DT;
      return counts;
    };

    const roots: THREE.Group[] = [];
    for (let k = 0; k < keys; k += 1) {
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2),
        new THREE.MeshBasicMaterial()
      );
      mesh.position.set(k * 0.4 - 0.4, 0, 0);
      root.add(mesh);
      deferredAnchor(group, `k${k}`).add(root);
      roots.push(root);
    }
    pass();

    let prevLook = look;
    let releases = 0;
    let releaseChanges = 0;
    for (const op of ops) {
      let released = false;
      if (op.kind === 't') store.setT(tOf(op.north, op.east, op.yawDeg));
      else if (op.kind === 'look') setLook(op.dir);
      else if (op.kind === 'epoch') store.bumpEpoch();
      else if (op.kind === 'jump')
        camera.position.x = camera.position.x > 0 ? -op.m / 2 : op.m / 2;
      else if (op.kind === 'release') {
        requestAnchorRelease('code-lock');
        released = true;
        releases += 1;
      } else if (op.kind === 'mature') store.mature();

      const before = roots.map((r) => r.matrix.clone());
      const counts = pass();
      const inView = look === 'in' || prevLook === 'in';
      let changedByRelease = false;
      roots.forEach((root, i) => {
        const changed = maxDiff(before[i]!, root.matrix) > 1e-12;
        const atNue = maxDiff(root.matrixWorld, IDENTITY) <= 1e-9;
        if (counts.windowOpen) expect(atNue).toBe(true);
        if (changed && !inView) seenMoves.outOfView += 1;
        if (!changed || !inView) return;
        seenMoves.inView += 1;
        if (atNue) return; // follow, window entry
        // Otherwise only a release may move it, and only to T^-1.
        expect(released).toBe(true);
        changedByRelease = true;
      });
      if (changedByRelease) releaseChanges += 1;
      expect(releaseChanges).toBeLessThanOrEqual(releases);
      prevLook = look;
    }

    // Liveness: mature, quiet until the window closes, then out of view.
    store.mature();
    for (let i = 0; i < 2600 && pass().windowOpen; i += 1);
    for (let i = 0; i < 60; i += 1) pass(); // the lerp settles, follow ends
    setLook('out');
    for (let i = 0; i < keys + 2; i += 1) pass();
    // Points inside each root's own bound: the set measures a key's
    // displacement over its root-local box corners plus the origin, so a
    // settled key moves the origin and its mesh's x extremes by at most
    // epsilon (a point outside that hull may move further).
    const tInv = group.matrix.clone().invert();
    roots.forEach((root, k) => {
      const cx = k * 0.4 - 0.4;
      const probes = [0, cx - 0.2, cx + 0.2].map(
        (x) => new THREE.Vector3(x, 0, 0)
      );
      root.updateMatrixWorld(true);
      for (const p of probes) {
        const local = p.clone().applyMatrix4(root.matrix);
        expect(
          local.distanceTo(p.clone().applyMatrix4(tInv))
        ).toBeLessThanOrEqual(DEFERRED_ANCHOR_EPSILON_M + 1e-9);
        // Paths 1 and 2: the world pose is the NUE pose (lerper snapped).
        const world = p.clone().applyMatrix4(root.matrixWorld);
        expect(world.distanceTo(p)).toBeLessThanOrEqual(
          DEFERRED_ANCHOR_EPSILON_M + 1e-3
        );
      }
    });
  } finally {
    g.location = before;
    runSessionDisposers();
    clearSessionDisposers();
    clearFrameUpdates();
  }
}

beforeEach(() => __resetAnchorReleaseForTests());
afterEach(() => __resetAnchorReleaseForTests());

describe('deferred anchors (properties)', () => {
  it('move in view only to NUE or at a release, and land on T^-1 once out of view', () => {
    fc.assert(
      fc.property(
        fc.record({
          ops: fc.array(opArb, { minLength: 1, maxLength: 40 }),
          matureAtStart: fc.boolean(),
          keys: fc.integer({ min: 1, max: 3 }),
          devJump: fc.boolean(),
        }),
        (scenario) => {
          __resetAnchorReleaseForTests();
          runScenario(scenario);
        }
      ),
      { numRuns: 60 }
    );
    expect(seenMoves.inView).toBeGreaterThan(0);
    expect(seenMoves.outOfView).toBeGreaterThan(0);
  });
});
