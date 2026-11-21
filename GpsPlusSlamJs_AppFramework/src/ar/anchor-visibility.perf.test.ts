/**
 * Subtree visibility predicate - per-call cost in the frame loop.
 *
 * Why this test matters: a content anchor with a pending re-placement asks
 * `isAnchorInView` every frame, for every view, until the answer is "out".
 * The cached test must stay a fixed, small amount of work (at most
 * ANCHOR_SPHERE_CAP spheres per view for a subtree with no skinned, morphed
 * or constant-size sprite parts, however large it is; those are never merged
 * and each adds one), and the fresh traversal that confirms an "out" must
 * stay cheap enough for the 1 s refresh. A regression that re-traversed on every cached call, or dropped the
 * sphere cap, would ship as a frame hitch no functional test can see, so
 * this file also pins the operation counts, which do not depend on the
 * machine. The fresh traversal is O(n^2) in the number of renderables
 * because of the merge down to the sphere cap; a large flat subtree should
 * be marked with mergeForAnchorBounds.
 *
 * Harness policy (as in `floor-estimator.perf.test.ts`): best-of-N timing
 * (the minimum damps scheduler noise), a deliberately GENEROUS wall-clock
 * ceiling because CI timing depends on the machine, and the measured number
 * in this header for humans.
 *
 * Measured locally (2026-11-21, Windows / node 24, machine at about 75 %
 * CPU from other jobs, so read the numbers as upper bounds), best of 15,
 * three runs: cached 0.006-0.008 ms per call, fresh 4.1-4.4 ms per call,
 * cached with a 64-bone skinned part 0.013-0.016 ms per call. The cached
 * ceilings are 100x above that. Two CI runs measured the fresh traversal at
 * 28.7 ms and 42.1 ms (about 6.5-10x the desktop), so its ceiling sits about
 * 3.6x above the slower one: it
 * catches a gross regression (a quadratic blow-up in the build, a traversal
 * per part), not a constant factor such as the earlier pair-heap merge
 * (21-24 ms on the desktop).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_SPHERE_CAP,
  createAnchorBoundsCache,
  createAnchorView,
  isAnchorInView,
  updateAnchorView,
  type AnchorVisibilityCounters,
  type XrCameraSource,
} from './anchor-visibility';

/** Renderable parts under the anchor: well above the sphere cap. */
const PARTS = 400;
/** Bones of the skinned part (a typical character rig). */
const BONES = 64;
const TIMING_RUNS = 15;
const CALLS_PER_RUN = 200;
/** Generous ceilings, ms per call. */
const CACHED_CEILING_MS = 1;
const FRESH_CEILING_MS = 150;
const SKINNED_CEILING_MS = 2;

function bestOf(runs: number, calls: number, fn: () => void): number {
  let best = Infinity;
  for (let r = 0; r < runs; r += 1) {
    const t0 = performance.now();
    for (let c = 0; c < calls; c += 1) fn();
    best = Math.min(best, (performance.now() - t0) / calls);
  }
  return best;
}

/** An anchor 10 m behind the camera (so every test runs to "out"). */
function buildScene(): {
  scene: THREE.Scene;
  anchor: THREE.Group;
  view: ReturnType<typeof createAnchorView>;
} {
  const scene = new THREE.Scene();
  const anchor = new THREE.Group();
  anchor.position.set(0, 0, 10);
  scene.add(anchor);
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  for (let i = 0; i < PARTS; i += 1) {
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set((i % 20) * 0.5, Math.floor(i / 20) * 0.5, 0);
    anchor.add(mesh);
  }
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  scene.add(camera);
  const left = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const right = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  right.position.x = 0.06;
  left.updateMatrix();
  right.updateMatrix();
  const xr: XrCameraSource = {
    isPresenting: true,
    getCamera: () => ({ cameras: [left, right] }),
  };
  scene.updateMatrixWorld(true);
  const view = updateAnchorView(createAnchorView(), camera, xr);
  return { scene, anchor, view };
}

describe('anchor-visibility cost', () => {
  it('a cached test costs at most the sphere cap per view and never traverses', () => {
    const { anchor, view } = buildScene();
    const cache = createAnchorBoundsCache();
    const counters: AnchorVisibilityCounters = {
      sphereTests: 0,
      traversals: 0,
    };
    const options = { marginDeg: 5, cache, nowMs: 0, counters };
    expect(isAnchorInView(view, anchor, options)).toBe(false);
    expect(counters.traversals).toBe(1);
    expect(counters.sphereTests).toBeLessThanOrEqual(ANCHOR_SPHERE_CAP * 2);
    const afterBuild = counters.sphereTests;
    const ms = bestOf(TIMING_RUNS, CALLS_PER_RUN, () => {
      isAnchorInView(view, anchor, options);
    });
    expect(counters.traversals).toBe(1);
    const calls = TIMING_RUNS * CALLS_PER_RUN;
    expect((counters.sphereTests - afterBuild) / calls).toBeLessThanOrEqual(
      ANCHOR_SPHERE_CAP * 2
    );
    console.info(
      `anchor-visibility cached: ${ms.toFixed(4)} ms/call (${PARTS} parts, 2 views)`
    );
    expect(ms).toBeLessThan(CACHED_CEILING_MS);
  });

  it('a fresh traversal of a 400-part subtree stays within its budget', () => {
    const { anchor, view } = buildScene();
    const cache = createAnchorBoundsCache();
    const counters: AnchorVisibilityCounters = {
      sphereTests: 0,
      traversals: 0,
    };
    const options = { marginDeg: 5, cache, nowMs: 0, fresh: true, counters };
    const ms = bestOf(TIMING_RUNS, 10, () => {
      isAnchorInView(view, anchor, options);
    });
    expect(counters.traversals).toBe(TIMING_RUNS * 10);
    console.info(
      `anchor-visibility fresh: ${ms.toFixed(4)} ms/call (${PARTS} parts, 2 views)`
    );
    expect(ms).toBeLessThan(FRESH_CEILING_MS);
  });

  it('a skinned part is bounded from its bones on every cached call within budget', () => {
    const { anchor, view } = buildScene();
    const geometry = new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
    const count = geometry.getAttribute('position').count;
    const index: number[] = [];
    const weight: number[] = [];
    for (let i = 0; i < count; i += 1) {
      index.push(i % BONES, (i + 1) % BONES, 0, 0);
      weight.push(0.5, 0.5, 0, 0);
    }
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(index, 4)
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(weight, 4)
    );
    const mesh = new THREE.SkinnedMesh(geometry);
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < BONES; i += 1) {
      const bone = new THREE.Bone();
      bone.position.y = i === 0 ? 0 : 0.05;
      (bones[i - 1] ?? mesh).add(bone);
      bones.push(bone);
    }
    mesh.bind(new THREE.Skeleton(bones));
    anchor.add(mesh);
    anchor.updateMatrixWorld(true);
    const cache = createAnchorBoundsCache();
    const options = { marginDeg: 5, cache, nowMs: 0 };
    expect(isAnchorInView(view, anchor, options)).toBe(false);
    const ms = bestOf(TIMING_RUNS, CALLS_PER_RUN, () => {
      isAnchorInView(view, anchor, options);
    });
    console.info(
      `anchor-visibility cached with a ${BONES}-bone skinned part: ${ms.toFixed(4)} ms/call`
    );
    expect(ms).toBeLessThan(SKINNED_CEILING_MS);
  });
});
