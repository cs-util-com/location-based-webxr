/**
 * Property-based tests for the wayfinding HUD presenter's id-keyed state.
 *
 * Why this test matters (2026-07-20 per-target config plan): per-target
 * hysteresis state is keyed by `id ?? index`. A consumer may rebuild and
 * reorder its getTargets() result every frame (sorting, filtering upstream,
 * fresh literals per call) — with stable ids the per-target state machine
 * must be COMPLETELY order-independent. The property compares a run that
 * feeds targets in identity order against a run applying an arbitrary
 * permutation per frame: the number of visible indicators must match on
 * every frame. Index keying would fail this whenever targets with different
 * hysteresis states swap places (the example-based reorder unit test in
 * wayfinding-hud.test.ts pins one such divergence explicitly — the "only if"
 * half of "state survives reordering iff ids are present").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';

import {
  createWayfindingHud,
  type WayfindingTarget,
} from './wayfinding-hud.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { clearSessionDisposers } from '../ar/session-disposers.js';

afterEach(() => {
  clearFrameUpdates();
  clearSessionDisposers();
});

const TARGET_COUNT = 3;

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

interface TargetFrameSpec {
  /** Camera-to-target distance in meters. */
  distance: number;
  /** Behind the camera (off-screen → arrow when active) vs. straight ahead. */
  behind: boolean;
}

/** Deterministic seeded permutation of [0..n) (Fisher–Yates, LCG-driven). */
function permutation(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const a = order[i] as number;
    order[i] = order[j] as number;
    order[j] = a;
  }
  return order;
}

/**
 * Drive one HUD through the frame specs, optionally permuting the target
 * order per frame, and record the visible-indicator count per frame.
 */
function runVisibleCounts(
  frames: TargetFrameSpec[][],
  orderSeeds: number[] | null
): number[] {
  const camera = makeCamera();
  let current: WayfindingTarget[] = [];
  const hud = createWayfindingHud({
    camera,
    getTargets: () => current,
    distanceMin: 1.5,
    distanceMax: 3.0,
    autoRegisterFrameUpdate: false,
  });

  const counts: number[] = [];
  frames.forEach((frame, frameIndex) => {
    const targets = frame.map((spec, targetIndex) => ({
      id: `t${targetIndex}`,
      position: new THREE.Vector3(
        0,
        0,
        spec.behind ? spec.distance : -spec.distance
      ),
    }));
    const order = orderSeeds
      ? permutation(targets.length, orderSeeds[frameIndex] as number)
      : targets.map((_, i) => i);
    current = order.map((i) => targets[i] as WayfindingTarget);

    hud.update(1 / 60);
    counts.push(
      camera.children.filter(
        (child) =>
          child.visible &&
          (child.name === 'wayfinding-circle' ||
            child.name === 'wayfinding-arrow')
      ).length
    );
  });
  hud.dispose();
  return counts;
}

describe('createWayfindingHud — id-keyed state properties', () => {
  it('visible indicators are invariant under per-frame reordering when ids are present', () => {
    const frameArb = fc.array(
      fc.record({
        distance: fc.double({ min: 0.2, max: 6, noNaN: true }),
        behind: fc.boolean(),
      }),
      { minLength: TARGET_COUNT, maxLength: TARGET_COUNT }
    );

    fc.assert(
      fc.property(
        fc.array(frameArb, { minLength: 1, maxLength: 6 }),
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        (frames, seeds) => {
          const reference = runVisibleCounts(frames, null);
          const permuted = runVisibleCounts(frames, seeds);
          expect(permuted).toEqual(reference);
        }
      )
    );
  });
});
