/**
 * Tests for `enableArWorldGroupAlignment` — the framework default that wires
 * the store's alignment selector to a lerped `arWorldGroup.matrix`.
 *
 * Why this test matters: this is the load-bearing fix for the GPS-anchor
 * frame-architecture bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-0650-gps-anchor-frame-architecture-bug-and-plan.md
 * Slice 2 / Bug A). The two simpler apps (MinimalExample, AnchorStarter) never
 * applied alignment to `arWorldGroup`, leaving the camera pure-VIO and forcing
 * every GPS anchor to absorb the full alignment delta on each re-registration.
 * This helper makes "apply lerped alignment to `arWorldGroup`" a single,
 * impossible-to-forget framework call. The tests pin:
 * - an already-present alignment is adopted at enable time (apps that enable
 *   after the first fix still register the view),
 * - a newly-dispatched alignment updates the lerper target and converges,
 * - the first target is applied instantly (no slide from identity), later
 *   targets ease,
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
} {
  const listeners = new Set<() => void>();
  let state = {
    gpsData: { gpsEvents: { alignmentMatrix: initial } },
  } as unknown as CombinedRootState;
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAlignment: (matrix: readonly number[] | null) => {
      state = {
        gpsData: { gpsEvents: { alignmentMatrix: matrix } },
      } as unknown as CombinedRootState;
      for (const listener of [...listeners]) listener();
    },
  };
}

function matrixIsIdentity(group: THREE.Object3D): boolean {
  return group.matrix.equals(new THREE.Matrix4());
}

/**
 * The lerper decomposes each target into position/quaternion/scale and
 * recomposes it, so even an instantly-applied first target is not bit-identical
 * to the source array. Compare element-wise with a tight tolerance instead.
 */
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
    // The first target is applied instantly on the first frame.
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

  it('applies the first dispatched alignment instantly, then eases to later ones', () => {
    const store = makeFakeStore(null);
    const arWorldGroup = new THREE.Group();
    const handle = enableArWorldGroupAlignment({ store, arWorldGroup });

    const m1 = makeNonTrivialAlignment(2);
    store.setAlignment(m1);
    runFrameUpdates(1, 1);
    // First target → instant (within decompose/compose float tolerance).
    expectMatrixClose(
      arWorldGroup.matrix.toArray(),
      new THREE.Matrix4().fromArray([...m1]).toArray()
    );

    const m2 = makeNonTrivialAlignment(3);
    store.setAlignment(m2);
    // A single tiny step must NOT have reached m2 yet (it eases).
    runFrameUpdates(1 / 60, 2);
    const partial = arWorldGroup.matrix.toArray();
    const target = new THREE.Matrix4().fromArray([...m2]).toArray();
    expect(partial).not.toEqual(target);

    // Many steps converge close to m2.
    for (let i = 0; i < 600; i++) runFrameUpdates(1 / 60, 3 + i / 60);
    const converged = new THREE.Vector3().setFromMatrixPosition(
      arWorldGroup.matrix
    );
    const want = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray([...m2])
    );
    expect(converged.distanceTo(want)).toBeLessThan(1e-3);
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
    expect(arWorldGroup.matrix.toArray()).toEqual(afterFirst);
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
    expect(arWorldGroup.matrix.toArray()).toEqual(afterFirst);
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

// Why: the deferred anchors under the group read T from this binding and
// run their pass inside its frame update. A pass that ran before the lerp
// step, or a binding that outlived its dispose, would place content
// against a stale or dead T.
describe('enableArWorldGroupAlignment: the parent binding', () => {
  it('registers a binding whose target is the lerper target, and runs the pass after the lerp step', () => {
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
    // The pass saw this frame's lerped matrix, not the one before it.
    expect(seen[0]).toEqual(group.matrix.toArray());
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
