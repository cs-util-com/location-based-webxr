/**
 * Tests for the `createGpsAnchor` bootstrap phase.
 *
 * Why this test matters: the bootstrap state machine is the part that
 * decides *when* an anchor commits to its first GPS pose. It MUST
 * - honour an optional settling window (no samples taken until the
 *   window elapses),
 * - sample at 1 Hz on subsequent ticks,
 * - take a per-coordinate median (so a single spike outlier cannot
 *   move the committed pose),
 * - flip `phase` to `'anchored'` and `isFullyAnchored` to true only
 *   when the configured number of samples has been collected,
 * - skip the entire phase when `skipBootstrap: true` and trust the
 *   supplied `gpsPoint` verbatim.
 *
 * Sub-step 2 of the GpsAnchor port plan
 * (../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md).
 */
// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGpsAnchor, type GpsAnchorSamplePoint } from './gps-anchor.js';
import { worldNueToGps } from './frame-conversions.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment.js';

function makeAnchorEnv() {
  const arWorldGroup = new THREE.Group();
  const object3D = new THREE.Object3D();
  arWorldGroup.add(object3D);
  const camera = new THREE.PerspectiveCamera();
  return { arWorldGroup, object3D, camera };
}

afterEach(() => {
  clearFrameUpdates();
});

describe('createGpsAnchor — bootstrap', () => {
  it('starts in `bootstrap` phase with `isFullyAnchored=false`', () => {
    const env = makeAnchorEnv();
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => ({ lat: 48.0, lon: 11.0 }),
    });
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    anchor.dispose();
  });

  it('skipBootstrap=true commits the supplied gpsPoint and flips to `anchored` immediately', () => {
    const env = makeAnchorEnv();
    const seed = { lat: 48.1, lon: 11.2, altitude: 500 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: seed,
      skipBootstrap: true,
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    expect(anchor.phase).toBe('anchored');
    expect(anchor.isFullyAnchored).toBe(true);
    expect(anchor.gpsPoint).toEqual(seed);
    anchor.dispose();
  });

  it.each([0, -1])(
    'throws when secondsToAccumulateGpsPose is %s (sub-1 sample count is invalid; skipBootstrap is the bypass)',
    (badCount) => {
      const env = makeAnchorEnv();
      // Why this test matters: a sub-1 sample count (especially `0`)
      // would otherwise commit the bootstrap median after the first
      // received sample, silently turning a misconfiguration into
      // surprising behaviour. We fail fast at the boundary and steer
      // callers to `skipBootstrap:true`.
      expect(() =>
        createGpsAnchor({
          ...env,
          gpsPoint: { lat: 48.0, lon: 11.0 },
          secondsToAccumulateGpsPose: badCount,
          getAlignmentMatrix: () => null,
          getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
          getCurrentGpsPoint: () => ({ lat: 48.0, lon: 11.0 }),
        })
      ).toThrow(/secondsToAccumulateGpsPose must be >= 1/);
      // The failed constructor must not leave the object registered, so
      // a subsequent valid anchor on the same object3D is allowed.
      const anchor = createGpsAnchor({
        ...env,
        gpsPoint: { lat: 48.0, lon: 11.0 },
        getAlignmentMatrix: () => null,
        getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
        getCurrentGpsPoint: () => ({ lat: 48.0, lon: 11.0 }),
      });
      expect(anchor.phase).toBe('bootstrap');
      anchor.dispose();
    }
  );

  it('collects samples at 1 Hz and commits the median after `secondsToAccumulateGpsPose` samples', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 5,
    });
    // 5 samples with strictly increasing lat — median = the middle one.
    const lats = [48.001, 48.002, 48.003, 48.004, 48.005];
    let elapsed = 0;
    for (const lat of lats) {
      elapsed += 1;
      currentSample = { lat, lon: 11.0 };
      anchor.__tickForTests(1, elapsed);
    }
    expect(anchor.phase).toBe('anchored');
    expect(anchor.isFullyAnchored).toBe(true);
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.003, 6);
    expect(anchor.gpsPoint.lon).toBeCloseTo(11.0, 6);
    anchor.dispose();
  });

  it('defaults to the object-pose bootstrap source when getCurrentGpsPoint is omitted (quality-review G-6)', () => {
    // Why this test matters: the object-pose sampler used to be hand-built in
    // every consumer and was the subtlest piece of anchor wiring — a wrong
    // re-derivation anchored silently wrong. The built-in default must
    // (a) skip ticks until zero AND alignment exist, and (b) sample the
    // OBJECT's world position converted via worldNueToGps.
    const env = makeAnchorEnv();
    env.object3D.position.set(10, 2, 20); // GPS-world NUE metres
    env.object3D.updateMatrixWorld(true);
    const zero = { lat: 48.0, lon: 11.0 };
    let alignment: readonly number[] | null = null;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero,
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => zero,
      secondsToAccumulateGpsPose: 1,
    });

    // No alignment yet → the sampler must skip (no commit).
    anchor.__tickForTests(1, 1);
    expect(anchor.phase).toBe('bootstrap');

    // Alignment appears → the next tick samples the object pose and commits.
    alignment = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    anchor.__tickForTests(1, 3);
    expect(anchor.phase).toBe('anchored');
    const expected = worldNueToGps({ x: 10, y: 2, z: 20 }, zero);
    expect(anchor.gpsPoint.lat).toBeCloseTo(expected.lat, 9);
    expect(anchor.gpsPoint.lon).toBeCloseTo(expected.lon, 9);
    expect((anchor.gpsPoint as { altitude?: number }).altitude).toBeCloseTo(
      2,
      9
    );
    anchor.dispose();
  });

  it('median is robust to a single spike outlier', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 5,
    });
    // Four clustered samples + one wildly outlier sample. The median
    // (sorted middle) is one of the clustered values — NOT the mean.
    const lats = [48.001, 48.002, 999.0, 48.003, 48.004];
    let elapsed = 0;
    for (const lat of lats) {
      elapsed += 1;
      currentSample = { lat, lon: 11.0 };
      anchor.__tickForTests(1, elapsed);
    }
    expect(anchor.isFullyAnchored).toBe(true);
    // Sorted: [48.001, 48.002, 48.003, 48.004, 999]; median = 48.003.
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.003, 6);
    anchor.dispose();
  });

  it('honours a `settlingSeconds` window — samples in the settling window are ignored', () => {
    const env = makeAnchorEnv();
    const samples: GpsAnchorSamplePoint[] = [];
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => {
        samples.push(currentSample);
        return currentSample;
      },
      secondsToAccumulateGpsPose: 3,
      settlingSeconds: 4,
    });
    // Tick once per second for 10 seconds: ticks 1..4 are inside the
    // settling window and MUST NOT be sampled; ticks 5,6,7 are sampled.
    for (let t = 1; t <= 10; t++) {
      currentSample = { lat: 48.0 + t * 0.001, lon: 11.0 };
      anchor.__tickForTests(1, t);
      if (anchor.phase === 'anchored') break;
    }
    expect(samples.length).toBe(3);
    expect(anchor.isFullyAnchored).toBe(true);
    // Sampled values were t=5,6,7 → lats 48.005, 48.006, 48.007.
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.006, 6);
    anchor.dispose();
  });

  it('skips a tick when `getCurrentGpsPoint` returns null (no GPS reading yet)', () => {
    const env = makeAnchorEnv();
    const samples: Array<GpsAnchorSamplePoint | null> = [];
    let currentSample: GpsAnchorSamplePoint | null = null;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => {
        samples.push(currentSample);
        return currentSample;
      },
      secondsToAccumulateGpsPose: 2,
    });
    // First two ticks: no GPS reading. Should NOT count as samples.
    anchor.__tickForTests(1, 1);
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    // Now GPS comes online.
    currentSample = { lat: 48.001, lon: 11.0 };
    anchor.__tickForTests(1, 3);
    currentSample = { lat: 48.003, lon: 11.0 };
    anchor.__tickForTests(1, 4);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.002, 6); // median of [.001,.003]
    anchor.dispose();
  });

  it('`markMovedExternally()` resets the anchor to `bootstrap` and clears the sample buffer', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 2,
    });
    // Drive into `anchored` state.
    currentSample = { lat: 48.001, lon: 11.0 };
    anchor.__tickForTests(1, 1);
    currentSample = { lat: 48.003, lon: 11.0 };
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('anchored');
    anchor.markMovedExternally();
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    // Re-bootstrap with new samples.
    currentSample = { lat: 49.001, lon: 11.0 };
    anchor.__tickForTests(1, 10);
    currentSample = { lat: 49.003, lon: 11.0 };
    anchor.__tickForTests(1, 11);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(49.002, 6);
    anchor.dispose();
  });

  it('`onBootstrapComplete` fires with the committed median and re-fires after re-bootstrap', () => {
    // Why this test matters: AnchorStarter persists the anchor's committed
    // reference into `?show=` via this callback, so the persisted link equals
    // the committed `gpsPoint` by construction. The callback must receive the
    // EXACT median (not the seed) and must re-fire on every re-bootstrap so a
    // moved anchor's link stays correct.
    const env = makeAnchorEnv();
    const committed: Array<{ lat: number; lon: number }> = [];
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 2,
      onBootstrapComplete: (point) => {
        committed.push({ lat: point.lat, lon: point.lon });
      },
    });

    currentSample = { lat: 48.001, lon: 11.0 };
    anchor.__tickForTests(1, 1);
    currentSample = { lat: 48.003, lon: 11.0 };
    anchor.__tickForTests(1, 2);
    // First commit: median of [48.001, 48.003] = 48.002, and the value must
    // equal the anchor's committed reference.
    expect(committed).toHaveLength(1);
    expect(committed[0]!.lat).toBeCloseTo(48.002, 6);
    expect(committed[0]!.lat).toBeCloseTo(anchor.gpsPoint.lat, 6);

    anchor.markMovedExternally();
    currentSample = { lat: 49.001, lon: 11.0 };
    anchor.__tickForTests(1, 10);
    currentSample = { lat: 49.003, lon: 11.0 };
    anchor.__tickForTests(1, 11);
    // Re-bootstrap commit: callback re-fires with the new median.
    expect(committed).toHaveLength(2);
    expect(committed[1]!.lat).toBeCloseTo(49.002, 6);
    anchor.dispose();
  });

  it('`onBootstrapComplete` never fires when `skipBootstrap` is true (no bootstrap to complete)', () => {
    const env = makeAnchorEnv();
    const onBootstrapComplete = vi.fn();
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.1, lon: 11.2, altitude: 500 },
      skipBootstrap: true,
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
      onBootstrapComplete,
    });
    expect(anchor.phase).toBe('anchored');
    expect(onBootstrapComplete).not.toHaveBeenCalled();
    anchor.dispose();
  });

  it('`dispose()` unregisters the anchor from the global frame loop', async () => {
    const env = makeAnchorEnv();
    const getCurrentGpsPoint = vi.fn<() => GpsAnchorSamplePoint | null>(() => ({
      lat: 48.0,
      lon: 11.0,
    }));
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint,
      secondsToAccumulateGpsPose: 999, // never finishes
    });
    const { runFrameUpdates } = await import('../ar/frame-loop.js');
    runFrameUpdates(1, 1);
    expect(getCurrentGpsPoint).toHaveBeenCalledTimes(1);
    anchor.dispose();
    runFrameUpdates(1, 2);
    expect(getCurrentGpsPoint).toHaveBeenCalledTimes(1);
  });

  it('throws when the parent chain already contains a `GpsAnchor`-managed object', () => {
    const env = makeAnchorEnv();
    const childObject = new THREE.Object3D();
    env.object3D.add(childObject);
    const parentAnchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    expect(() =>
      createGpsAnchor({
        arWorldGroup: env.arWorldGroup,
        object3D: childObject,
        camera: env.camera,
        gpsPoint: { lat: 48.0, lon: 11.0 },
        getAlignmentMatrix: () => null,
        getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
        getCurrentGpsPoint: () => null,
      })
    ).toThrow(/nested/i);
    parentAnchor.dispose();
  });

  it('throws when object3D is not a descendant of the passed arWorldGroup (scene-root mistake)', () => {
    // Why this test matters: a GPS anchor only stays stable in the AR view
    // when its object3D rides the alignment-bearing `arWorldGroup` (the node
    // the camera also lives under). Parenting it to the scene root instead
    // means the alignment is never applied to it via scene-graph propagation,
    // so each steady-state re-registration snaps the FULL alignment delta and
    // the object visibly slides as the user moves. The framework must make
    // this mistake impossible rather than silently "working".
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    scene.add(arWorldGroup);
    // object3D is parented to the scene root, NOT under arWorldGroup.
    const sceneRootObject = new THREE.Object3D();
    scene.add(sceneRootObject);
    expect(() =>
      createGpsAnchor({
        arWorldGroup,
        object3D: sceneRootObject,
        camera,
        gpsPoint: { lat: 48.0, lon: 11.0 },
        getAlignmentMatrix: () => null,
        getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
        getCurrentGpsPoint: () => null,
      })
    ).toThrow(/descendant of arWorldGroup/i);
  });

  it('throws when object3D is detached (no parent chain reaching arWorldGroup)', () => {
    // A freshly-created object that was never added to arWorldGroup is the
    // degenerate case of the scene-root mistake — it can never ride the
    // alignment. Reject it at construction time.
    const arWorldGroup = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const detached = new THREE.Object3D();
    expect(() =>
      createGpsAnchor({
        arWorldGroup,
        object3D: detached,
        camera,
        gpsPoint: { lat: 48.0, lon: 11.0 },
        getAlignmentMatrix: () => null,
        getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
        getCurrentGpsPoint: () => null,
      })
    ).toThrow(/descendant of arWorldGroup/i);
  });

  it('accepts an object nested several levels deep under arWorldGroup', () => {
    // The guard must walk the full parent chain, not just check the direct
    // parent — apps legitimately nest content under intermediate groups.
    const arWorldGroup = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const intermediate = new THREE.Group();
    const leaf = new THREE.Object3D();
    arWorldGroup.add(intermediate);
    intermediate.add(leaf);
    const anchor = createGpsAnchor({
      arWorldGroup,
      object3D: leaf,
      camera,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    expect(anchor.phase).toBe('bootstrap');
    anchor.dispose();
  });
});

/**
 * Sub-step 3 of the GpsAnchor port plan: steady-state in
 * `'snap-every-tick'` mode. The anchor MUST
 * - on each tick after bootstrap, compute the GPS-world NUE target
 *   from `calcRelativeCoordsInMeters(zeroRef, gpsPoint)`, map it into
 *   the AR-local frame by pre-multiplying with `alignment⁻¹` (the
 *   inverse of `arWorldGroup`'s matrix), and write the result to
 *   `object3D.position` so the object reaches the correct WORLD pose,
 * - skip the commit when the delta is below the (distance-scaled)
 *   threshold so on-screen pops are avoided,
 * - re-commit when `setGpsPoint` changes the target,
 * - NOT modify `object3D.position` while still in the `'bootstrap'`
 *   phase.
 *
 * The dual mode-gate (`'snap-when-offscreen'`) and the alignment-
 * matrix large-jump bypass are sub-step 4; they get their own tests.
 */
describe('createGpsAnchor — steady state (snap-every-tick)', () => {
  it('commits NUE target to object3D.position on the first tick after bootstrap', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: 48.001, lon: 11.0 }; // ~111 m north
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, target);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 3);
    expect(env.object3D.position.y).toBeCloseTo(expected[1], 3);
    expect(env.object3D.position.z).toBeCloseTo(expected[2], 3);
    anchor.dispose();
  });

  it('does NOT modify object3D.position while in the bootstrap phase', () => {
    const env = makeAnchorEnv();
    env.object3D.position.set(42, 43, 44);
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.001, lon: 11.0 },
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBe(42);
    expect(env.object3D.position.y).toBe(43);
    expect(env.object3D.position.z).toBe(44);
    anchor.dispose();
  });

  it('re-commits when `setGpsPoint` changes the target by more than the threshold', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero, // target == zero → local (0,0,0)
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    // Move target 5 m north (well above the default 2 m threshold).
    const newTarget = { lat: zero.lat + 5 / 111319, lon: zero.lon };
    anchor.setGpsPoint(newTarget);
    anchor.__tickForTests(1, 2);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, newTarget);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 2);
    anchor.dispose();
  });

  it('skips the commit when the delta is below the distance threshold', () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      // Camera at origin, object commits to (0,0,0), so distanceFromCamera=0 → scale=1
      // and the default 2 m threshold applies as-is.
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1); // commits (0,0,0)
    // Move target 1 m north — below the 2 m threshold.
    const subThresholdTarget = { lat: zero.lat + 1 / 111319, lon: zero.lon };
    anchor.setGpsPoint(subThresholdTarget);
    anchor.__tickForTests(1, 2);
    // Position should not have changed.
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    expect(env.object3D.position.y).toBeCloseTo(0, 4);
    expect(env.object3D.position.z).toBeCloseTo(0, 4);
    anchor.dispose();
  });

  it('scales the threshold by `1 + distanceFromCamera/10` — same delta commits up close, skips far away', () => {
    const zero = { lat: 48.0, lon: 11.0 };
    // First scenario: camera at origin, object near origin → scale=1, threshold=2 m.
    // A 3 m delta exceeds it.
    {
      const env = makeAnchorEnv();
      const anchor = createGpsAnchor({
        ...env,
        gpsPoint: zero,
        skipBootstrap: true,
        mode: 'snap-every-tick',
        getAlignmentMatrix: () =>
          Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
        getGpsZeroRef: () => zero,
        getCurrentGpsPoint: () => null,
      });
      anchor.__tickForTests(1, 1); // commits (0,0,0)
      anchor.setGpsPoint({ lat: zero.lat + 3 / 111319, lon: zero.lon });
      anchor.__tickForTests(1, 2);
      expect(env.object3D.position.x).toBeGreaterThan(2); // committed to ~3 m
      anchor.dispose();
    }
    // Second scenario: object lives 100 m north of the camera → scale=11, threshold=22 m.
    // A 3 m delta is far below 22 m → skip.
    {
      const env = makeAnchorEnv();
      // Camera at origin; the object will commit to ~100 m north because we choose a
      // 100 m offset between zero and the anchor target.
      const farTarget = { lat: zero.lat + 100 / 111319, lon: zero.lon };
      const anchor = createGpsAnchor({
        ...env,
        gpsPoint: farTarget,
        skipBootstrap: true,
        mode: 'snap-every-tick',
        getAlignmentMatrix: () =>
          Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
        getGpsZeroRef: () => zero,
        getCurrentGpsPoint: () => null,
      });
      anchor.__tickForTests(1, 1); // commits ~ (100, 0, 0)
      const committedX = env.object3D.position.x;
      expect(committedX).toBeGreaterThan(90);
      // Move target 3 m further north — below the distance-scaled threshold (~22 m).
      anchor.setGpsPoint({ lat: zero.lat + 103 / 111319, lon: zero.lon });
      anchor.__tickForTests(1, 2);
      expect(env.object3D.position.x).toBeCloseTo(committedX, 3);
      anchor.dispose();
    }
  });

  it('skips the commit when `getGpsZeroRef` returns null (origin not yet established)', () => {
    const env = makeAnchorEnv();
    env.object3D.position.set(7, 8, 9);
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.001, lon: 11.0 },
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => null,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBe(7);
    expect(env.object3D.position.y).toBe(8);
    expect(env.object3D.position.z).toBe(9);
    anchor.dispose();
  });
});

/**
 * Sub-step 4 of the GpsAnchor port plan: `snap-when-offscreen` mode. The
 * anchor MUST
 * - place a freshly-spawned `skipBootstrap` anchor on its FIRST commit even
 *   while on-screen (the one-time initial-placement exemption — a fresh
 *   appearance is not a jump),
 * - thereafter skip the steady-state commit when the object is currently
 *   inside the camera frustum (even if the threshold gate would allow it, and
 *   no matter how large the alignment-matrix delta),
 * - commit when the object is outside the camera frustum.
 *
 * The previous "large-jump bypass" (which overrode the on-screen gate on a
 * >2°/4 m/20 m alignment delta) was REMOVED: now that the whole frame rides one
 * lerped `arWorldGroup.matrix`, a large jump is absorbed smoothly for the entire
 * view, so a per-anchor on-screen snap only manufactured the AnchorStarter
 * cache-hit hard-jump. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md.
 *
 * Tests use a real `THREE.Mesh` (not `Object3D`) because the
 * frustum-visibility module's `isObjectInCameraFrustum` requires a
 * geometry/bounding-sphere to evaluate.
 */
function makeMeshAnchorEnv() {
  const arWorldGroup = new THREE.Group();
  const object3D = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial()
  );
  arWorldGroup.add(object3D);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  return { arWorldGroup, object3D, camera };
}

const IDENTITY_MATRIX16: readonly number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

function rotationYMatrix16(degrees: number): readonly number[] {
  // Column-major 4×4 pure rotation about the Y axis.
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function setupSceneFor(env: ReturnType<typeof makeMeshAnchorEnv>): void {
  env.arWorldGroup.updateMatrixWorld(true);
  env.camera.updateMatrixWorld(true);
  // matrixWorldInverse is derived; recompute it explicitly because we
  // construct the frustum from `projectionMatrix × matrixWorldInverse`
  // and tests don't go through `renderer.render`.
  env.camera.matrixWorldInverse.copy(env.camera.matrixWorld).invert();
}

describe('createGpsAnchor — steady state (snap-when-offscreen)', () => {
  it('does NOT snap on-screen when a large alignment jump arrives after the initial placement', () => {
    // Why this test matters: regression for the AnchorStarter `?show=` cache-hit
    // "hard jump". A `skipBootstrap` anchor observed during early convergence
    // sees >2°/tick alignment-rotation deltas. The old large-jump bypass let
    // such a delta override the `snap-when-offscreen` frustum gate and snap the
    // marker WHILE the user was looking straight at it. The fix removes that
    // bypass: once the one-time initial placement is consumed, every later
    // correction must wait until the object is off-screen — no matter how large
    // the alignment delta. See
    // gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md.
    const env = makeMeshAnchorEnv();
    // Step 1 — place the object OFF-SCREEN so the one-time placement bypass is
    // consumed without making the later on-screen assertion ambiguous. Camera
    // looks away from the origin → the freshly-spawned object at (0,0,0) is
    // behind the camera.
    env.camera.position.set(0, 0, -5);
    env.camera.lookAt(0, 0, -10);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon }; // 10 m north
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1); // initial placement bypass commits (off-screen)
    expect(env.object3D.position.x).toBeGreaterThan(8); // placed at ~10 m north
    const placedX = env.object3D.position.x;

    // Step 2 — now LOOK AT the placed object so it is on-screen, then push a
    // large alignment-rotation jump (30°, far above the old 2° bypass
    // threshold). The placement bypass is already consumed, so the on-screen
    // frustum gate MUST hold and the object MUST NOT discretely snap.
    env.camera.position.set(placedX, 0, 5);
    env.camera.lookAt(placedX, 0, 0);
    setupSceneFor(env);
    matrix = rotationYMatrix16(30);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeCloseTo(placedX, 4); // no on-screen snap
    anchor.dispose();
  });

  it('first commit places a skipBootstrap anchor even while on-screen (initial-placement exemption)', () => {
    // A skipBootstrap anchor is `anchored` from frame one but its object3D sits
    // at the AR origin (inside the user) until its first commit. That first
    // placement MUST land even on-screen, otherwise the marker stays stuck at
    // the origin until the user looks away (the AnchorStarter `?show=` reveal).
    // Only the FIRST commit is exempt — the repro test above locks in that
    // later on-screen corrections stay gated.
    const env = makeMeshAnchorEnv();
    // Camera looks at the origin from 5 m back along +Z → object at (0,0,0) is on-screen.
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    // 10 m north target → posDelta = 10 m, scale ≈ 1.5 (distance ≈ 5 m), threshold ≈ 3 m → gate passes.
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    // Initial-placement exemption: the object leaves the origin despite being
    // on-screen.
    expect(env.object3D.position.x).toBeGreaterThan(8); // placed at ~10 m north
    anchor.dispose();
  });

  it('commits a steady-state correction when the object is outside the camera frustum', () => {
    const env = makeMeshAnchorEnv();
    // Camera looks *away* from the origin → the object is off-screen throughout.
    env.camera.position.set(0, 0, -5);
    env.camera.lookAt(0, 0, -10);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: zero.lat + 10 / 111319, lon: zero.lon },
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1); // initial placement (off-screen) → ~10 m
    expect(env.object3D.position.x).toBeGreaterThan(8);
    // A LATER correction must still commit while off-screen — this exercises the
    // frustum gate proper, not just the one-time initial-placement exemption.
    anchor.setGpsPoint({ lat: zero.lat + 20 / 111319, lon: zero.lon });
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeGreaterThan(18); // ~20 m, committed off-screen
    anchor.dispose();
  });
});

/**
 * Sub-step 5 of the GpsAnchor port plan: `markMovedExternally()`
 * interplay with the steady-state loop. The anchor MUST
 * - stop committing position updates while back in the `'bootstrap'`
 *   phase after `markMovedExternally()`,
 * - resume steady-state commits using the *new* median target once
 *   the re-bootstrap completes,
 * - NOT re-arm the one-time on-screen initial-placement exemption: a
 *   re-bootstrap moves an already-placed object, so its first
 *   post-rebootstrap correction is a normal frustum-gated snap.
 */
describe('createGpsAnchor — re-bootstrap on external move', () => {
  it('stops committing position updates while back in `bootstrap` and resumes after the new median is committed', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    let currentSample: GpsAnchorSamplePoint = zero;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 2,
    });
    // Steady state commits (0,0,0).
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);

    // External move: re-enter bootstrap.
    anchor.markMovedExternally();
    expect(anchor.phase).toBe('bootstrap');

    // While in bootstrap, even if the alignment matrix or zero ref changes,
    // the position MUST NOT be committed.
    env.object3D.position.set(-7, -8, -9);
    currentSample = { lat: zero.lat + 100 / 111319, lon: zero.lon };
    anchor.__tickForTests(1, 10); // first sample
    expect(env.object3D.position.x).toBe(-7);
    expect(env.object3D.position.y).toBe(-8);
    expect(env.object3D.position.z).toBe(-9);

    // Second sample completes the (size-2) bootstrap → phase flips to anchored.
    anchor.__tickForTests(1, 11);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(zero.lat + 100 / 111319, 6);

    // Next tick is the first steady-state tick post-rebootstrap; it must commit
    // to the NEW median target, not silently inherit any prior state.
    anchor.__tickForTests(1, 12);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, anchor.gpsPoint);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 2);
    anchor.dispose();
  });

  it('does NOT re-arm the on-screen initial-placement exemption after a re-bootstrap', () => {
    // Why this test matters: the one-time on-screen placement exemption exists
    // only so a freshly-spawned `skipBootstrap` anchor can leave the AR origin.
    // A re-bootstrap moves an object that is ALREADY placed at a real pose, so
    // re-arming the exemption would let it pop on-screen — exactly the jump the
    // fix removes. The exemption must stay consumed across `markMovedExternally`.
    const env = makeMeshAnchorEnv();
    // Place the object OFF-SCREEN first so the one-time exemption is consumed.
    env.camera.position.set(0, 0, -5);
    env.camera.lookAt(0, 0, -10);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    let currentSample: GpsAnchorSamplePoint = target;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 1,
    });
    anchor.__tickForTests(1, 1); // initial placement (off-screen) → ~10 m
    const placedX = env.object3D.position.x;
    expect(placedX).toBeGreaterThan(8);

    // External move + re-bootstrap to a NEW target 30 m north, completing
    // immediately (size-1 accumulation).
    currentSample = { lat: zero.lat + 30 / 111319, lon: zero.lon };
    anchor.markMovedExternally();
    anchor.__tickForTests(1, 2); // one sample → re-anchored
    expect(anchor.phase).toBe('anchored');

    // Now LOOK AT the placed object. The new median target is ~20 m further
    // north (past the threshold), but because the exemption is NOT re-armed the
    // on-screen frustum gate MUST suppress the correction — the object stays put.
    env.camera.position.set(placedX, 0, 5);
    env.camera.lookAt(placedX, 0, 0);
    setupSceneFor(env);
    anchor.__tickForTests(1, 3);
    expect(env.object3D.position.x).toBeCloseTo(placedX, 4); // suppressed on-screen
    anchor.dispose();
  });
});

/**
 * Alignment-frame correctness (regression for the bug documented in
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).
 *
 * Why this test matters: `object3D` is parented to `arWorldGroup`, whose
 * `matrix` IS the alignment matrix mapping **AR-odometry NUE → GPS-world
 * NUE**. To make the object's *world* position equal the GPS-world target
 * `nue`, its *local* position must be `alignment⁻¹ · nue`. The original
 * implementation wrote raw `nue` as the local position, so the world
 * position became `alignment · nue` (the alignment was applied twice). That
 * defect was invisible to every earlier test because they used an
 * **identity** alignment matrix (`I⁻¹ · nue == nue`) and asserted on the
 * *local* position.
 *
 * These tests close the gap by (a) using a deliberately non-trivial
 * alignment matrix via `makeNonTrivialAlignment`, (b) applying it to a real
 * `arWorldGroup`, and (c) asserting on `getWorldPosition` — the frame that
 * actually encodes the requirement.
 */
function applyAlignmentToGroup(
  group: THREE.Object3D,
  matrix16: readonly number[]
): void {
  group.matrix.fromArray(matrix16);
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
}

describe('createGpsAnchor — alignment-frame correctness', () => {
  it('places the object at the GPS-world target in WORLD space under a non-trivial alignment', async () => {
    const env = makeAnchorEnv();
    const alignment = makeNonTrivialAlignment(42);
    applyAlignmentToGroup(env.arWorldGroup, alignment);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: 48.001, lon: 11.0005 }; // ~111 m N, ~37 m E
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const nue = calcRelativeCoordsInMeters(zero, target);
    const world = env.object3D.getWorldPosition(new THREE.Vector3());
    // World position MUST equal the GPS-world NUE target, independent of the
    // alignment matrix. Pre-fix this failed (object landed at alignment·nue).
    expect(world.x).toBeCloseTo(nue[0], 3);
    expect(world.y).toBeCloseTo(nue[1], 3);
    expect(world.z).toBeCloseTo(nue[2], 3);
    anchor.dispose();
  });

  it('keeps the WORLD position fixed at the GPS target as the alignment matrix changes', async () => {
    const env = makeAnchorEnv();
    let alignment = makeNonTrivialAlignment(1);
    applyAlignmentToGroup(env.arWorldGroup, alignment);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: 48.0009, lon: 10.9994 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const nue = calcRelativeCoordsInMeters(zero, target);
    for (const seed of [1, 7, 13, 99]) {
      alignment = makeNonTrivialAlignment(seed);
      applyAlignmentToGroup(env.arWorldGroup, alignment);
      anchor.__tickForTests(1, seed + 1);
      const world = env.object3D.getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(nue[0], 2);
      expect(world.y).toBeCloseTo(nue[1], 2);
      expect(world.z).toBeCloseTo(nue[2], 2);
    }
    anchor.dispose();
  });

  it('skips the commit (leaves the local pose untouched) when the alignment matrix is null', () => {
    const env = makeAnchorEnv();
    // arWorldGroup left at identity; the anchor cannot place an AR-local
    // object without knowing AR↔NUE, so it must leave the pose as-is.
    env.object3D.position.set(3, 4, 5);
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.001, lon: 11.0 },
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBe(3);
    expect(env.object3D.position.y).toBe(4);
    expect(env.object3D.position.z).toBe(5);
    anchor.dispose();
  });

  it('preserves the metre threshold under a rigid alignment (sub-threshold delta still does not commit)', () => {
    // The threshold gate compares AR-local distances. A rigid (rotation +
    // translation, unit-scale) alignment preserves Euclidean distance, so a
    // sub-threshold NUE delta must remain sub-threshold in AR-local space and
    // NOT commit — confirming the 2 m gate keeps its meaning across the frame.
    const env = makeAnchorEnv();
    const alignment = makeNonTrivialAlignment(5);
    applyAlignmentToGroup(env.arWorldGroup, alignment);
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero, // target == zero → world (0,0,0)
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1); // commits the zero target
    const committed = env.object3D.position.clone();
    // Move target 1 m north — below the default 2 m threshold.
    anchor.setGpsPoint({ lat: zero.lat + 1 / 111319, lon: zero.lon });
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.distanceTo(committed)).toBeLessThan(1e-6);
    anchor.dispose();
  });
});

/**
 * Cross-consumer convention consistency (Action item 3 of the alignment-frame
 * bug doc). All GPS-world consumers must land the same GPS point at the same
 * WORLD position under the same alignment, so the placement convention can't
 * silently diverge between modules.
 *
 * The two scene-root consumers —
 * `GpsPlusSlamJs_RecorderApp/src/visualization/sync-gps-anchored-meshes.ts`
 * and the *raw GPS markers* of `./gps-event-markers.ts` — both write **raw
 * NUE** as a *local* position on an object parented to the **scene root**
 * (root = GPS-world NUE, so local == world). `createGpsAnchor` instead
 * parents to `arWorldGroup` (AR-odometry frame) and must pre-multiply by
 * `alignment⁻¹` to reach the *same* world position. This test reconstructs
 * the real scene hierarchy (scene → arWorldGroup[alignment] → anchor object)
 * plus a scene-root mesh placed with raw NUE, and asserts both land at the
 * identical world position. It is kept in-package (rather than importing the
 * RecorderApp reconciler across the package boundary) by reproducing that
 * module's documented scene-root + raw-NUE convention directly.
 */
describe('createGpsAnchor — cross-consumer convention consistency', () => {
  it('lands the same GPS point at the same WORLD position as a scene-root raw-NUE consumer', async () => {
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: 48.0008, lon: 11.0006 };
    const alignment = makeNonTrivialAlignment(17);

    // Real hierarchy: scene root (NUE world) → arWorldGroup (alignment) → object.
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    scene.add(arWorldGroup);
    applyAlignmentToGroup(arWorldGroup, alignment);
    const anchorObject = new THREE.Object3D();
    arWorldGroup.add(anchorObject);
    const camera = new THREE.PerspectiveCamera();

    // Scene-root consumer (sync-gps-anchored-meshes / raw GPS markers):
    // raw NUE written as a LOCAL position on a root-parented object.
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const nue = calcRelativeCoordsInMeters(zero, target);
    const rootMesh = new THREE.Object3D();
    rootMesh.position.set(nue[0], nue[1], nue[2]);
    scene.add(rootMesh);
    scene.updateMatrixWorld(true);

    const anchor = createGpsAnchor({
      arWorldGroup,
      object3D: anchorObject,
      camera,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      distanceThreshold: 0, // force the commit so we compare placement only
      getAlignmentMatrix: () => alignment,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    scene.updateMatrixWorld(true);

    const anchorWorld = anchorObject.getWorldPosition(new THREE.Vector3());
    const rootWorld = rootMesh.getWorldPosition(new THREE.Vector3());
    anchor.dispose();

    // Both consumers must agree to within 1 mm.
    expect(anchorWorld.distanceTo(rootWorld)).toBeLessThan(1e-3);
  });
});
