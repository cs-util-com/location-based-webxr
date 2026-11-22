/**
 * Tests for `enableArWorldGroupAlignment` — the framework default that wires
 * the store's alignment selector to `arWorldGroup.matrix`.
 *
 * Why this test matters: this is the load-bearing fix for the GPS-anchor
 * frame-architecture bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-0650-gps-anchor-frame-architecture-bug-and-plan.md
 * Slice 2 / Bug A). The two simpler apps (MinimalExample, AnchorStarter) never
 * applied alignment to `arWorldGroup`, leaving the camera pure-VIO and forcing
 * every GPS anchor to absorb the full alignment delta on each re-registration.
 * This helper makes "apply the alignment to `arWorldGroup`" a single,
 * impossible-to-forget framework call. The tests pin:
 * - an already-present alignment is adopted at enable time (apps that enable
 *   after the first fix still register the view),
 * - every dispatched alignment, large or small, lands exactly in the next
 *   frame (no easing anywhere in the framework),
 * - `null` alignment is ignored (no spurious identity target),
 * - `dispose()` stops both the subscription and the per-frame update.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { enableArWorldGroupAlignment } from './ar-world-group-alignment.js';
import { getArParentBinding } from '../ar/ar-parent-target.js';
import { runFrameUpdates, clearFrameUpdates } from '../ar/frame-loop.js';
import {
  runSessionDisposers,
  clearSessionDisposers,
} from '../ar/session-disposers.js';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment.js';
import type { SubscribableStore } from '../state/subscribe-to-selector.js';
import type { CombinedRootState } from '../state/combined-root-state.js';

/**
 * Minimal fake store exposing only the `gpsData.gpsEvents.alignmentMatrix`
 * slice that `selectAlignmentMatrix` reads. `setAlignment` replaces the
 * `gpsData` reference so the memoized selector recomputes (mirrors how the
 * real reducer produces a fresh slice on each alignment update).
 */
function makeFakeStore(initial: readonly number[] | null): SubscribableStore & {
  setAlignment: (matrix: readonly number[] | null) => void;
  bumpEpoch: () => void;
} {
  const listeners = new Set<() => void>();
  let alignmentMatrix = initial;
  let frameEpoch = 0;
  const build = () =>
    ({
      gpsData: { gpsEvents: { alignmentMatrix } },
      qrDetected: { frameEpoch },
    }) as unknown as CombinedRootState;
  let state = build();
  const publish = () => {
    state = build();
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAlignment: (matrix: readonly number[] | null) => {
      alignmentMatrix = matrix;
      publish();
    },
    bumpEpoch: () => {
      frameEpoch += 1;
      publish();
    },
  };
}

/** T as north metres (x), a yaw in degrees and east metres (z). */
function tOf(north: number, yawDeg = 0, east = 0): number[] {
  return new THREE.Matrix4()
    .makeRotationY(THREE.MathUtils.degToRad(yawDeg))
    .setPosition(north, 0, east)
    .toArray();
}

/** A group in a scene, driven by the binding, with a frame clock. */
function arRig(initial: readonly number[] | null) {
  const store = makeFakeStore(initial);
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const handle = enableArWorldGroupAlignment({ store, arWorldGroup: group });
  let t = 0;
  const frame = (dt = 1 / 30) => {
    t += dt;
    runFrameUpdates(dt, t);
  };
  return { store, group, handle, frame };
}

function matrixIsIdentity(group: THREE.Object3D): boolean {
  return group.matrix.equals(new THREE.Matrix4());
}

/** Element-wise equality (+0 and -0 alike): the group carries T itself. */
function expectMatrixExact(
  actual: readonly number[],
  expected: readonly number[]
): void {
  for (let i = 0; i < 16; i++) expect(actual[i]! - expected[i]!).toBe(0);
}

/** Element-wise comparison with a tight tolerance. */
function expectMatrixClose(
  actual: readonly number[],
  expected: readonly number[]
): void {
  for (let i = 0; i < 16; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 6);
  }
}

afterEach(() => {
  clearFrameUpdates();
  clearSessionDisposers();
});

describe('enableArWorldGroupAlignment', () => {
  it('adopts an alignment already present in the store at enable time', () => {
    const m = makeNonTrivialAlignment(1);
    const store = makeFakeStore(m);
    const arWorldGroup = new THREE.Group();

    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
    // The alignment lands on the first frame.
    runFrameUpdates(1, 1);

    expect(matrixIsIdentity(arWorldGroup)).toBe(false);
    expectMatrixClose(
      arWorldGroup.matrix.toArray(),
      new THREE.Matrix4().fromArray([...m]).toArray()
    );
    handle.dispose();
  });

  it('leaves arWorldGroup at identity while the store alignment is null', () => {
    const store = makeFakeStore(null);
    const arWorldGroup = new THREE.Group();

    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
    runFrameUpdates(1, 1);

    expect(matrixIsIdentity(arWorldGroup)).toBe(true);
    handle.dispose();
  });

  it('applies the first dispatched alignment, and a small refinement, exactly in the next frame', () => {
    const store = makeFakeStore(null);
    const arWorldGroup = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });

    const m1 = makeNonTrivialAlignment(2);
    store.setAlignment(m1);
    runFrameUpdates(1, 1);
    expectMatrixExact(arWorldGroup.matrix.toArray(), [...m1]);

    // A 1 cm refinement lands in one frame too: nothing eases.
    const m2 = new THREE.Matrix4()
      .makeTranslation(0.01, 0, 0)
      .multiply(new THREE.Matrix4().fromArray([...m1]))
      .toArray();
    store.setAlignment(m2);
    runFrameUpdates(1 / 60, 2);
    expectMatrixExact(arWorldGroup.matrix.toArray(), m2);
    handle.dispose();
  });

  it('stops updating arWorldGroup after dispose()', () => {
    const m1 = makeNonTrivialAlignment(4);
    const store = makeFakeStore(m1);
    const arWorldGroup = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
    runFrameUpdates(1, 1);
    const afterFirst = arWorldGroup.matrix.toArray();

    handle.dispose();
    // A post-dispose dispatch + frames must not move the group.
    store.setAlignment(makeNonTrivialAlignment(5));
    runFrameUpdates(1, 2);
    runFrameUpdates(1, 3);
    expectMatrixExact(arWorldGroup.matrix.toArray(), afterFirst);
  });

  // Why these matter: the leak that two apps independently hit was the store
  // subscription surviving a session teardown. enableArWorldGroupAlignment now
  // registers its own disposal with the session registry that resetWebXRState
  // flushes, so an app calls it once and never has to hold the handle. These
  // pin that the teardown flush actually releases the subscription, and that a
  // manual dispose() afterwards is a safe no-op (idempotent).
  it('auto-disposes on the session teardown flush (no manual dispose needed)', () => {
    const m1 = makeNonTrivialAlignment(6);
    const store = makeFakeStore(m1);
    const arWorldGroup = new THREE.Group();
    enableArWorldGroupAlignment({ store, arWorldGroup }); // handle intentionally discarded
    runFrameUpdates(1, 1);
    const afterFirst = arWorldGroup.matrix.toArray();

    // Simulate the session teardown chokepoint (resetWebXRState flushes this).
    runSessionDisposers();

    // The subscription is gone: a later dispatch + frames must not move the
    // group, exactly as an explicit dispose() would have guaranteed.
    store.setAlignment(makeNonTrivialAlignment(7));
    runFrameUpdates(1, 2);
    runFrameUpdates(1, 3);
    expectMatrixExact(arWorldGroup.matrix.toArray(), afterFirst);
  });

  it('dispose() after the teardown flush is an idempotent no-op', () => {
    const store = makeFakeStore(makeNonTrivialAlignment(8));
    const arWorldGroup = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });

    runSessionDisposers(); // teardown already disposed it
    // A handle the app happens to still hold must not double-tear-down or throw.
    expect(() => handle.dispose()).not.toThrow();
  });

  it('manual dispose() deregisters, so the later teardown flush is a no-op', () => {
    const store = makeFakeStore(makeNonTrivialAlignment(9));
    const arWorldGroup = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });

    // Disposing mid-session must remove the registration so the teardown flush
    // doesn't try to run a teardown whose resources are already gone.
    handle.dispose();
    expect(() => runSessionDisposers()).not.toThrow();
  });

  // Why this test matters: content that follows the alignment (the deferred
  // anchors' follow phase) sets its local matrix to the inverse of
  // `arWorldGroup.matrix` and expects its world pose to be its NUE pose. That
  // holds only if every binding update leaves `matrixWorld` equal to `matrix`
  // under the identity scene root, in the same frame.
  it('leaves arWorldGroup.matrixWorld equal to its matrix after every update', () => {
    const store = makeFakeStore(makeNonTrivialAlignment(10));
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
    const check = (): void =>
      expectMatrixClose(
        arWorldGroup.matrixWorld.toArray(),
        arWorldGroup.matrix.toArray()
      );
    runFrameUpdates(1 / 30, 1);
    check();
    store.setAlignment(makeNonTrivialAlignment(11));
    for (let i = 0; i < 40; i++) {
      runFrameUpdates(1 / 30, 2 + i / 30);
      check();
    }
    handle.dispose();
  });
});

// Why: the framework always shows the newest alignment, so every change of
// T lands exactly in the frame its version changes, whatever its size, its
// rotation or the frame epoch; smoothing, if an app wants it, lives above
// this layer.
describe('enableArWorldGroupAlignment: every change lands at once', () => {
  it.each([
    ['a large step and yaw', tOf(5, 20, -3)],
    ['a 1 cm step', tOf(0.01)],
    ['a 0.1 degree yaw', tOf(0, 0.1)],
    ['a 30 degree yaw about the origin', tOf(0, 30)],
  ])('lands %s exactly in the frame it arrives', (_name, t) => {
    const rig = arRig(tOf(0));
    rig.frame();
    rig.store.setAlignment(t);
    rig.frame();
    expectMatrixExact(rig.group.matrix.toArray(), t);
    expectMatrixClose(rig.group.matrixWorld.toArray(), t);
    rig.handle.dispose();
  });

  it('lands every change of a noisy 1 Hz series in its own frame, and holds it between changes', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const rig = arRig(tOf(0));
    rig.frame();
    for (let second = 0; second < 10; second += 1) {
      const next = tOf(rand() - 0.5, rand() - 0.5, rand() - 0.5);
      rig.store.setAlignment(next);
      for (let f = 0; f < 30; f += 1) {
        rig.frame();
        expectMatrixExact(rig.group.matrix.toArray(), next);
      }
    }
    rig.handle.dispose();
  });

  it('does not change what it lands around a frame-epoch change', () => {
    const rig = arRig(tOf(0));
    rig.frame();
    rig.store.bumpEpoch();
    rig.frame();
    expectMatrixExact(rig.group.matrix.toArray(), tOf(0));
    rig.store.setAlignment(tOf(0.3));
    rig.frame();
    expectMatrixExact(rig.group.matrix.toArray(), tOf(0.3));
    rig.handle.dispose();
  });
});

// Why: the deferred anchors under the group read T from this binding and
// run their pass inside its frame update. A pass that ran before the lerp
// step, or a binding that outlived its dispose, would place content
// against a stale or dead T.
describe('enableArWorldGroupAlignment: the parent binding', () => {
  it('registers a binding whose target is the applied T, and runs the pass after the alignment step', () => {
    const a = makeNonTrivialAlignment(7);
    const store = makeFakeStore(a);
    const group = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup: group });
    const binding = getArParentBinding(group);
    expect(binding).not.toBeNull();
    expectMatrixClose(binding!.target.target().toArray(), a);
    const seen: number[][] = [];
    binding!.attachPass(() => seen.push(group.matrix.toArray()));
    const b = makeNonTrivialAlignment(8);
    store.setAlignment(b);
    runFrameUpdates(1 / 30, 0);
    expect(seen).toHaveLength(1);
    // The pass saw this frame's matrix, already at the new T.
    expect(seen[0]).toEqual(group.matrix.toArray());
    expectMatrixClose(seen[0]!, b);
    expectMatrixClose(binding!.target.target().toArray(), b);
    handle.dispose();
  });

  it('unregisters on dispose, stops the pass and tells its listeners', () => {
    const store = makeFakeStore(makeNonTrivialAlignment(9));
    const group = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup: group });
    const binding = getArParentBinding(group)!;
    let passes = 0;
    let disposed = 0;
    binding.attachPass(() => (passes += 1));
    binding.onDispose(() => (disposed += 1));
    handle.dispose();
    runFrameUpdates(1 / 30, 0);
    expect(getArParentBinding(group)).toBeNull();
    expect(passes).toBe(0);
    expect(disposed).toBe(1);
    handle.dispose();
    expect(disposed).toBe(1);
  });
});
