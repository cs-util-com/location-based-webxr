/**
 * Property-based tests for `createGpsAnchor` — the alignment-frame contract.
 *
 * Why these tests matter: the defining invariant of a `GpsAnchor` is that an
 * anchored object's **world** position equals its GPS-world target and is
 * **independent of the alignment matrix**. The earlier example-based tests
 * all used an identity alignment, which makes a whole family of *wrong*
 * implementations (identity, double-application, inverse, transpose) look
 * correct — that degeneracy hid the alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).
 *
 * A single property — "world pose is invariant under the alignment matrix" —
 * is the cleanest executable spec of what `GpsAnchor` *is*, and it would have
 * caught the bug directly. We pair it with the `inverse(M) ∘ M ≈ I`
 * round-trip that underpins the fix.
 */
// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { afterEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { createGpsAnchor } from './gps-anchor.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { calcRelativeCoordsInMeters, type LatLong } from '../core/index.js';
import { enableArWorldGroupAlignment } from './ar-world-group-alignment.js';
import {
  __runPassForTests,
  DEFERRED_ANCHOR_EPSILON_M,
} from '../ar/deferred-anchors.js';
import {
  __resetAnchorReleaseForTests,
  requestAnchorRelease,
} from '../ar/anchor-release.js';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from '../ar/session-disposers.js';
import type { SubscribableStore } from '../state/subscribe-to-selector.js';

afterEach(() => {
  clearFrameUpdates();
});

// ---------------------------------------------------------------------------
// Arbitraries — random RIGID alignment matrices (rotation + translation, unit
// scale), mirroring the real alignment matrix whose scale ≈ 1. Unit
// scale keeps the transform exactly invertible and distance-preserving.
// ---------------------------------------------------------------------------

const arbUnit = fc.double({ min: -1, max: 1, noNaN: true });
const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const arbTranslationComponent = fc.double({ min: -50, max: 50, noNaN: true });

/** A random rigid 4×4 alignment matrix as a column-major 16-array. */
const arbRigidAlignment = fc
  .record({
    ax: arbUnit,
    ay: arbUnit,
    az: arbUnit,
    angle: arbAngle,
    tx: arbTranslationComponent,
    ty: arbTranslationComponent,
    tz: arbTranslationComponent,
  })
  .map(({ ax, ay, az, angle, tx, ty, tz }) => {
    const axis = new THREE.Vector3(ax, ay, az);
    // Guard a degenerate (near-zero) axis so the quaternion is well defined.
    if (axis.lengthSq() < 1e-6) axis.set(1, 2, 3);
    axis.normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(tx, ty, tz),
      quat,
      new THREE.Vector3(1, 1, 1)
    );
    return matrix.toArray();
  });

/** GPS target offsets (degrees) ≈ ±110 m around a fixed origin near Munich. */
const arbLatOffset = fc.double({ min: -0.001, max: 0.001, noNaN: true });
const arbLonOffset = fc.double({ min: -0.001, max: 0.001, noNaN: true });

function applyAlignmentToGroup(
  group: THREE.Object3D,
  matrix16: readonly number[]
): void {
  group.matrix.fromArray(matrix16);
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
}

describe('createGpsAnchor — alignment-frame properties', () => {
  it('the anchored object WORLD position is invariant under the alignment matrix', () => {
    const zero = { lat: 48.0, lon: 11.0 };
    fc.assert(
      fc.property(
        arbRigidAlignment,
        arbLatOffset,
        arbLonOffset,
        (alignment, dLat, dLon) => {
          const arWorldGroup = new THREE.Group();
          const object3D = new THREE.Object3D();
          arWorldGroup.add(object3D);
          // Far from every target, so the commit is a real move: a target
          // within the set's epsilon of the start is (rightly) not committed
          // and would leave the object up to 2 cm off.
          object3D.position.set(0, 1000, 0);
          applyAlignmentToGroup(arWorldGroup, alignment);
          const camera = new THREE.PerspectiveCamera();
          const target = { lat: zero.lat + dLat, lon: zero.lon + dLon };
          const anchor = createGpsAnchor({
            arWorldGroup,
            object3D,
            camera,
            gpsPoint: target,
            skipBootstrap: true,
            mode: 'snap-every-tick',
            // Force a commit every tick so this property isolates *where* the
            // commit lands (the frame contract) from the distance-scaled
            // threshold gate, which legitimately skips small moves and would
            // otherwise leave the object at its initial local (0,0,0) for the
            // (common) random draws whose AR-local displacement is below the
            // gate — that is correct anchor behaviour, just not what this
            // property is about.
            distanceThreshold: 0,
            getAlignmentMatrix: () => alignment,
            getGpsZeroRef: () => zero,
            getCurrentGpsPoint: () => null,
          });
          anchor.__tickForTests(1, 1);
          const nue = calcRelativeCoordsInMeters(zero, target);
          const world = object3D.getWorldPosition(new THREE.Vector3());
          anchor.dispose();
          clearFrameUpdates();
          // World position equals the GPS-world target regardless of the
          // (arbitrary, non-trivial) alignment matrix. 1 mm tolerance; the
          // double-applied bug would land the object tens of metres away.
          expect(world.x).toBeCloseTo(nue[0], 3);
          expect(world.y).toBeCloseTo(nue[1], 3);
          expect(world.z).toBeCloseTo(nue[2], 3);
        }
      )
    );
  });

  it('inverse(M) ∘ M ≈ identity for any rigid alignment matrix', () => {
    fc.assert(
      fc.property(arbRigidAlignment, (alignment) => {
        const m = new THREE.Matrix4().fromArray(alignment);
        const composed = new THREE.Matrix4().copy(m).invert().multiply(m);
        const identity = new THREE.Matrix4(); // identity by default
        const a = composed.elements;
        const b = identity.elements;
        for (let i = 0; i < 16; i++) {
          expect(a[i]).toBeCloseTo(b[i]!, 5);
        }
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Under an alignment binding: code-lock releases and frame-switch windows.
// ---------------------------------------------------------------------------

const BOUND_ZERO: LatLong = { lat: 48.0, lon: 11.0 };
const BOUND_DT = 1 / 20;

/** A store with what the binding reads: T, a mature extent and a frame epoch. */
function makeBoundStore() {
  const listeners = new Set<() => void>();
  let alignment: number[] = new THREE.Matrix4().toArray();
  let epoch = 0;
  const positions = [0, 40].map((n, i) => ({
    id: `p${i}`,
    timestamp: i,
    coordinates: [n, 0, 0] as [number, number, number],
  }));
  const build = () => ({
    gpsData: {
      zero: BOUND_ZERO,
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

type BoundOp =
  | { kind: 't'; north: number; east: number; yawDeg: number }
  | { kind: 'look'; dir: 'in' | 'out' }
  | { kind: 'epoch' }
  | { kind: 'release' }
  | { kind: 'idle' };

const boundOpArb = (withLook: boolean): fc.Arbitrary<BoundOp> =>
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        kind: fc.constant('t' as const),
        north: fc.double({ min: -4, max: 4, noNaN: true }),
        east: fc.double({ min: -4, max: 4, noNaN: true }),
        yawDeg: fc.double({ min: -10, max: 10, noNaN: true }),
      }),
    },
    {
      weight: withLook ? 2 : 0,
      arbitrary: fc.record({
        kind: fc.constant('look' as const),
        dir: fc.constantFrom('in' as const, 'out' as const),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'epoch' as const }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'release' as const }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'idle' as const }) }
  );

interface BoundScenario {
  ops: BoundOp[];
  dNorth: number;
  dEast: number;
}

const boundScenarioArb = (withLook: boolean): fc.Arbitrary<BoundScenario> =>
  fc.record({
    ops: fc.array(boundOpArb(withLook), { minLength: 1, maxLength: 30 }),
    dNorth: fc.double({ min: -2, max: 2, noNaN: true }),
    dEast: fc.double({ min: -2, max: 2, noNaN: true }),
  });

/**
 * A bound world group, a camera 30 m in front of its origin (facing it, or
 * away after a `look` op `out`) and an anchor of a 1 m sphere near the
 * origin, created at its first target (so its first placement is done).
 * Under the ops' T (within 4 m and 10 degrees) the sphere stays in the
 * camera's view while it faces the origin.
 */
function boundWorld(
  { dNorth, dEast }: BoundScenario,
  overrides: Partial<Parameters<typeof createGpsAnchor>[0]>
) {
  const store = makeBoundStore();
  const group = new THREE.Group();
  new THREE.Scene().add(group);
  enableArWorldGroupAlignment({ store, arWorldGroup: group });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 30);
  group.add(camera);
  const point = {
    lat: BOUND_ZERO.lat + dNorth / 111319,
    lon: BOUND_ZERO.lon + dEast / 74500,
  };
  const n = calcRelativeCoordsInMeters(BOUND_ZERO, point);
  const nue = new THREE.Vector3(n[0], n[1], n[2]);
  const object3D = new THREE.Mesh(
    new THREE.SphereGeometry(1),
    new THREE.MeshBasicMaterial()
  );
  object3D.position.copy(nue); // T is the identity at creation
  group.add(object3D);
  createGpsAnchor({
    object3D,
    arWorldGroup: group,
    camera,
    gpsPoint: point,
    skipBootstrap: true,
    getAlignmentMatrix: () => store.alignment(),
    getGpsZeroRef: () => BOUND_ZERO,
    ...overrides,
  });
  // One pass at T = identity: the first step finds it at its target.
  __runPassForTests(group, camera, BOUND_DT, 0);
  let elapsed = BOUND_DT;
  return {
    object3D,
    /** Applies `op`; true when it requested a release. */
    apply(op: BoundOp): boolean {
      if (op.kind === 't') {
        store.setT(
          new THREE.Matrix4()
            .makeTranslation(op.north, 0, op.east)
            .multiply(
              new THREE.Matrix4().makeRotationY(
                THREE.MathUtils.degToRad(op.yawDeg)
              )
            )
        );
      } else if (op.kind === 'look') {
        camera.rotation.set(0, op.dir === 'in' ? 0 : Math.PI, 0);
      } else if (op.kind === 'epoch') store.bumpEpoch();
      else if (op.kind === 'release') {
        requestAnchorRelease('code-lock');
        return true;
      }
      return false;
    },
    /** One frame: the binding's step, then the set's pass. */
    pass() {
      const counts = __runPassForTests(group, camera, BOUND_DT, elapsed);
      elapsed += BOUND_DT;
      return counts;
    },
    /** The distance of the anchor's world position from its GPS-world NUE. */
    worldError(): number {
      object3D.updateWorldMatrix(true, false);
      return object3D.getWorldPosition(new THREE.Vector3()).distanceTo(nue);
    },
  };
}

function cleanUpBoundWorld(): void {
  runSessionDisposers();
  clearSessionDisposers();
  clearFrameUpdates();
  __resetAnchorReleaseForTests();
}

describe('createGpsAnchor under a binding: release and window events (properties)', () => {
  it('in view, it moves only at a release or in an open window, and a release lands it on its NUE', () => {
    // Why this test matters: the view gate has exactly two event
    // exceptions, a code lock and a frame-switch window; a correction's
    // size is never one. A random mix of T steps, frame switches and
    // releases with the anchor always in view must show every move
    // explained by one of the two, and a release must land it.
    const seen = { release: 0, window: 0 };
    const t3: BoundOp = { kind: 't', north: 3, east: 0, yawDeg: 0 };
    fc.assert(
      fc.property(boundScenarioArb(false), (scenario) => {
        __resetAnchorReleaseForTests();
        try {
          const w = boundWorld(scenario, {
            mode: 'snap-when-offscreen',
            distanceThreshold: 0.2,
          });
          const unexplainedMoves: number[] = [];
          let worstReleaseError = 0;
          scenario.ops.forEach((op, i) => {
            const released = w.apply(op);
            const before = w.object3D.position.clone();
            const { windowOpen } = w.pass();
            const moved = w.object3D.position.distanceTo(before) > 1e-12;
            if (moved && released) seen.release += 1;
            else if (moved && windowOpen) seen.window += 1;
            else if (moved) unexplainedMoves.push(i);
            if (released) {
              worstReleaseError = Math.max(worstReleaseError, w.worldError());
            }
          });
          expect(unexplainedMoves).toEqual([]);
          expect(worstReleaseError).toBeLessThanOrEqual(
            DEFERRED_ANCHOR_EPSILON_M + 1e-9
          );
        } finally {
          cleanUpBoundWorld();
        }
      }),
      {
        numRuns: 60,
        // One of each event that moves it, so neither count can stay 0.
        examples: [
          [{ ops: [t3, { kind: 'release' }], dNorth: 0, dEast: 0 }],
          [{ ops: [{ kind: 'epoch' }, t3], dNorth: 0, dEast: 0 }],
        ],
      }
    );
    expect(seen.release).toBeGreaterThan(0);
    expect(seen.window).toBeGreaterThan(0);
  });

  it('snap-every-tick lands every frame, unaffected by release, window and dwell', () => {
    // Why this test matters: `snap-every-tick` is the caller's choice to
    // skip the view gate. Its anchor must sit on its NUE after every pass,
    // whether it is in view, just turned away (the two-pass dwell), at a
    // release or in a frame-switch window. Threshold 0, so only the set's
    // epsilon is left between the anchor and its NUE.
    fc.assert(
      fc.property(boundScenarioArb(true), (scenario) => {
        __resetAnchorReleaseForTests();
        try {
          const w = boundWorld(scenario, {
            mode: 'snap-every-tick',
            distanceThreshold: 0,
          });
          for (const op of scenario.ops) {
            w.apply(op);
            w.pass();
            expect(w.worldError()).toBeLessThanOrEqual(
              DEFERRED_ANCHOR_EPSILON_M + 1e-9
            );
          }
        } finally {
          cleanUpBoundWorld();
        }
      }),
      { numRuns: 60 }
    );
  });
});
