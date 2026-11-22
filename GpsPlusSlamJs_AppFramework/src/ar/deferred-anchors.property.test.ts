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
 *   matrix changes only at a release (to T^-1, at most once per release) or
 *   to put it at its NUE pose while a follow is due: the window is open, or
 *   the alignment is immature and no code has voted, or the root was still
 *   following and has not yet reached T^-1. The oracle keeps its own model
 *   of "following", from the window flag, the target's maturity and the
 *   root's exact box corners.
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
import { getArParentBinding } from './ar-parent-target';
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

/** Applies one op; true when it requested a release. */
function applyOp(
  op: Op,
  store: ReturnType<typeof makeStore>,
  camera: THREE.Camera,
  setLook: (dir: 'in' | 'out') => void
): boolean {
  if (op.kind === 't') store.setT(tOf(op.north, op.east, op.yawDeg));
  else if (op.kind === 'look') setLook(op.dir);
  else if (op.kind === 'epoch') store.bumpEpoch();
  else if (op.kind === 'jump')
    camera.position.x = camera.position.x > 0 ? -op.m / 2 : op.m / 2;
  else if (op.kind === 'mature') store.mature();
  else if (op.kind === 'release') {
    requestAnchorRelease('code-lock');
    return true;
  }
  return false;
}

/** What the oracle knows about one pass. */
interface PassFacts {
  readonly windowOpen: boolean;
  readonly inView: boolean;
  readonly released: boolean;
  /** A follow phase is due: the window is open, or immature with no release yet. */
  readonly due: boolean;
}

/** The exact box corners (and origin) of root k's mesh, root-local. */
function cornersOfRoot(k: number): THREE.Vector3[] {
  const cx = k * 0.4 - 0.4;
  const corners = [new THREE.Vector3()];
  for (let i = 0; i < 8; i += 1) {
    corners.push(
      new THREE.Vector3(
        cx + (i & 1 ? 0.2 : -0.2),
        i & 2 ? 0.2 : -0.2,
        i & 4 ? 0.2 : -0.2
      )
    );
  }
  return corners;
}

function farFrom(a: THREE.Matrix4, b: THREE.Matrix4, k: number): boolean {
  return cornersOfRoot(k).some(
    (c) =>
      c.clone().applyMatrix4(a).distanceTo(c.clone().applyMatrix4(b)) >
      DEFERRED_ANCHOR_EPSILON_M
  );
}

/**
 * The safety oracle for one pass: an in-view root changes only at a
 * release, or to its NUE pose while a follow is due or still running.
 * Updates `following` (the oracle's model) and returns true when a release
 * moved an in-view root.
 */
function checkSafety(
  roots: THREE.Object3D[],
  before: THREE.Matrix4[],
  following: boolean[],
  facts: PassFacts,
  tInv: THREE.Matrix4
): boolean {
  let changedByRelease = false;
  roots.forEach((root, i) => {
    const changed = maxDiff(before[i]!, root.matrix) > 1e-12;
    const mayFollow = facts.due || following[i]!;
    following[i] =
      facts.due ||
      (following[i]! && !facts.released && farFrom(root.matrix, tInv, i));
    if (checkRootMove(root, changed, mayFollow, facts)) changedByRelease = true;
  });
  return changedByRelease;
}

/** One root's move against the oracle; true when only a release explains it. */
function checkRootMove(
  root: THREE.Object3D,
  changed: boolean,
  mayFollow: boolean,
  facts: PassFacts
): boolean {
  const atNue = maxDiff(root.matrixWorld, IDENTITY) <= 1e-9;
  if (facts.windowOpen) expect(atNue).toBe(true);
  if (changed && !facts.inView) seenMoves.outOfView += 1;
  if (!changed || !facts.inView) return false;
  seenMoves.inView += 1;
  if (atNue && mayFollow) return false; // follow, window entry
  // Otherwise only a release may move it, and only to T^-1.
  expect(facts.released).toBe(true);
  return true;
}

/**
 * Points inside each root's own bound: the set measures a key's
 * displacement over its root-local box corners plus the origin, so a
 * settled key moves the origin and its mesh's x extremes by at most
 * epsilon (a point outside that hull may move further).
 */
function checkLiveness(group: THREE.Object3D, roots: THREE.Object3D[]): void {
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
}

interface World {
  store: ReturnType<typeof makeStore>;
  group: THREE.Group;
  camera: THREE.PerspectiveCamera;
  roots: THREE.Group[];
  look(): 'in' | 'out';
  setLook(dir: 'in' | 'out'): void;
  pass(): ReturnType<typeof __runPassForTests>;
}

/** A world group under the alignment binding, a camera in it, and one root per key. */
function buildWorld(keys: number, matureAtStart: boolean): World {
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
  return { store, group, camera, roots, look: () => look, setLook, pass };
}

/** Runs the ops, checking the safety oracle after every pass. */
function runOps(world: World, ops: Op[], matureAtStart: boolean): void {
  const { store, camera, roots, setLook, pass } = world;
  const target = getArParentBinding(world.group)!.target;
  let prevLook = world.look();
  let releases = 0;
  let releaseChanges = 0;
  // A key added in a follow phase starts following.
  const following = roots.map(() => !matureAtStart);
  for (const op of ops) {
    const released = applyOp(op, store, camera, setLook);
    if (released) releases += 1;

    const before = roots.map((r) => r.matrix.clone());
    const counts = pass();
    const facts: PassFacts = {
      windowOpen: counts.windowOpen,
      inView: world.look() === 'in' || prevLook === 'in',
      released,
      due: counts.windowOpen || (releases === 0 && !target.isMature()),
    };
    const tInv = target.target().clone().invert();
    if (checkSafety(roots, before, following, facts, tInv)) {
      releaseChanges += 1;
    }
    expect(releaseChanges).toBeLessThanOrEqual(releases);
    prevLook = world.look();
  }
}

function runScenario({ ops, matureAtStart, keys, devJump }: Scenario): void {
  const g = globalThis as { location?: unknown };
  const before = g.location;
  g.location = {
    search: devJump ? '?devWorldJumpM=1.5&devWorldJumpDeg=3' : '',
  };
  try {
    const world = buildWorld(keys, matureAtStart);
    world.pass();
    runOps(world, ops, matureAtStart);

    // Liveness: mature, quiet until the window closes, then out of view.
    world.store.mature();
    for (let i = 0; i < 2600 && world.pass().windowOpen; i += 1);
    for (let i = 0; i < 60; i += 1) world.pass(); // the lerp settles, follow ends
    world.setLook('out');
    for (let i = 0; i < keys + 2; i += 1) world.pass();
    checkLiveness(world.group, world.roots);
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
