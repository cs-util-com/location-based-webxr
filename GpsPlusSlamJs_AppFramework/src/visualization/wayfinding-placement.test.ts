/**
 * Parity tests for the wayfinding placement seam.
 *
 * Why these tests matter:
 * These are the ports of the field-validated Prototype-2 `hud-placement.js`
 * unit tests (AR_Wayfinding_HUD_Component/Task 2, PR #194) and pin the ported
 * behavior BEFORE any refactoring liberties — see
 * GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md.
 * One prototype test is intentionally NOT ported: `getEvaluationCamera`
 * (prefers-the-XR-sub-camera) — that renderer-dependent path was dropped by
 * the plan's mono-`getCamera()` decision; callers pass the framework's
 * logical camera explicitly instead.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import {
  computeTargetPlacement,
  formatDistanceLabel,
  getHudFrustumExtents,
  type ArrowPlacement,
  type CirclePlacement,
} from './wayfinding-placement.js';

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('formatDistanceLabel', () => {
  it('rounds to one decimal place', () => {
    expect(formatDistanceLabel(12.34)).toBe('12.3 m');
    expect(formatDistanceLabel(12.96)).toBe('13.0 m');
  });
});

describe('getHudFrustumExtents', () => {
  it('uses perspective camera fov and aspect', () => {
    const camera = makeCamera();
    const { width, height } = getHudFrustumExtents(camera, 2, false);

    expect(Math.abs(height - 2.309401076758503)).toBeLessThan(1e-12);
    expect(Math.abs(width - 4.618802153517006)).toBeLessThan(1e-12);
  });

  it('reads XR frustum scale from the projection matrix', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.projectionMatrix.elements[0] = 2;
    camera.projectionMatrix.elements[5] = 4;

    const { width, height } = getHudFrustumExtents(camera, 3, true);

    expect(width).toBe(3);
    expect(height).toBe(1.5);
  });
});

describe('computeTargetPlacement', () => {
  it('returns the expected state for close, far, and off-screen targets', () => {
    const camera = makeCamera();

    const closePlacement = computeTargetPlacement({
      targetWorldPos: new THREE.Vector3(0, 0, -0.5),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });

    expect(closePlacement.state).toBe('hidden');
    expect(closePlacement.distanceLabel).toBe('0.5 m');

    const farPlacement = computeTargetPlacement({
      targetWorldPos: new THREE.Vector3(0, 0, -5),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });

    expect(farPlacement.state).toBe('circle');
    const circle = farPlacement as CirclePlacement;
    expect(circle.circlePosition.z).toBe(-2.5);
    expect(circle.labelPosition.z).toBe(-2.5);

    const offScreenPlacement = computeTargetPlacement({
      targetWorldPos: new THREE.Vector3(10, 0, -5),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });

    expect(offScreenPlacement.state).toBe('arrow');
    const arrow = offScreenPlacement as ArrowPlacement;
    expect(arrow.arrowPosition.x).toBeGreaterThan(0);
    expect(Math.abs(arrow.arrowRotationZ + Math.PI / 2)).toBeLessThan(1e-12);
  });

  // Why this test matters: distanceMin/distanceMax form a hysteresis deadband
  // (see the Prototype-2 plan "HUD config"). A hidden target must not
  // reactivate until it is at least distanceMax away, while an already-visible
  // target (circle or arrow) stays visible all the way down to distanceMin.
  // Without this, distanceMax is silently ignored and indicators flicker at
  // the distanceMin boundary.
  it('applies distanceMin/distanceMax hysteresis for on-screen targets', () => {
    const camera = makeCamera();
    const base = {
      targetWorldPos: new THREE.Vector3(0, 0, -2), // 2 m: between 1.5 and 3.0
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    } as const;

    // A hidden target between the thresholds must stay hidden…
    const stillHidden = computeTargetPlacement({
      ...base,
      previousState: 'hidden',
    });
    expect(stillHidden.state).toBe('hidden');

    // …until it reaches distanceMax.
    const activated = computeTargetPlacement({
      ...base,
      targetWorldPos: new THREE.Vector3(0, 0, -3),
      previousState: 'hidden',
    });
    expect(activated.state).toBe('circle');

    // An active circle keeps showing inside the deadband (no flicker)…
    const stillCircle = computeTargetPlacement({
      ...base,
      previousState: 'circle',
    });
    expect(stillCircle.state).toBe('circle');

    // …and only hides once the user is closer than distanceMin ("arrived").
    const arrived = computeTargetPlacement({
      ...base,
      targetWorldPos: new THREE.Vector3(0, 0, -1),
      previousState: 'circle',
    });
    expect(arrived.state).toBe('hidden');

    // A target the arrow was just pointing at must not vanish when the user
    // turns toward it: visible states convert to circle inside the deadband.
    const fromArrow = computeTargetPlacement({
      ...base,
      previousState: 'arrow',
    });
    expect(fromArrow.state).toBe('circle');
  });

  it('flips the arrow direction for targets behind the camera', () => {
    const camera = makeCamera();

    const placement = computeTargetPlacement({
      targetWorldPos: new THREE.Vector3(2, 0, 5),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });

    expect(placement.state).toBe('arrow');
    expect(placement.isBehind).toBe(true);
    const arrow = placement as ArrowPlacement;
    expect(arrow.arrowPosition).toBeInstanceOf(THREE.Vector3);
    // The target sits behind and to the RIGHT; the flip must point the
    // arrow right (positive x, rotation -π/2 relative to "up"), not
    // mirror it left.
    expect(arrow.arrowPosition.x).toBeGreaterThan(0);
    expect(Math.abs(arrow.arrowRotationZ + Math.PI / 2)).toBeLessThan(1e-12);
    expect(formatDistanceLabel(placement.distance)).toMatch(/^\d+\.\d m$/);
  });

  // Why these tests matter (2026-07-18 field report + design decision):
  // visibility is a pure DISTANCE state machine, independent of the view
  // direction. The original prototype parity made the deadband
  // path-dependent — an on-screen target inside it stayed hidden, but a
  // glance away promoted it to an arrow (off-screen ignored distance) and
  // looking back converted that arrow to a ring at only distanceMin,
  // bypassing the distanceMax activation. The revised rules:
  // - SPAWN (no previousState): visible iff distance ≥ distanceMin —
  //   a target beyond the short-distance limit gets its ring immediately.
  // - Deactivated ('hidden'): nothing shows — no ring AND no arrow —
  //   until distance ≥ distanceMax, regardless of where you look.
  describe('distance-gated visibility (2026-07-18 revision)', () => {
    const camera = makeCamera();
    const base = {
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    };

    it('a fresh spawn beyond distanceMin shows its ring immediately, even inside the deadband', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -2), // 2 m — inside 1.5/3.0
      });
      expect(placement.state).toBe('circle');
    });

    it('a fresh spawn below distanceMin shows nothing — on-screen or off', () => {
      const near = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -1), // 1 m < distanceMin
      });
      expect(near.state).toBe('hidden');

      const nearOffScreen = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 1), // 1 m BEHIND the camera
      });
      expect(nearOffScreen.state).toBe('hidden'); // no arrow either
    });

    it('a deactivated target stays fully hidden through a look-away/look-back cycle (no bypass)', () => {
      const lookAwayCamera = makeCamera();
      const seq = { ...base, camera: lookAwayCamera };
      const near = new THREE.Vector3(0, 0, -1); // inside the "arrived" zone

      let placement = computeTargetPlacement({
        ...seq,
        targetWorldPos: near,
      });
      expect(placement.state).toBe('hidden');

      // Look away: still hidden — NO edge arrow for an inactive target.
      lookAwayCamera.lookAt(0, 0, 1);
      lookAwayCamera.updateMatrixWorld(true);
      placement = computeTargetPlacement({
        ...seq,
        targetWorldPos: near,
        previousState: placement.state,
      });
      expect(placement.state).toBe('hidden');

      // Look back: still hidden — the glance changed nothing.
      lookAwayCamera.lookAt(0, 0, -1);
      lookAwayCamera.updateMatrixWorld(true);
      placement = computeTargetPlacement({
        ...seq,
        targetWorldPos: near,
        previousState: placement.state,
      });
      expect(placement.state).toBe('hidden');
    });

    it('a deactivated target reactivates only at distanceMax — off-screen included', () => {
      // Off-screen, deactivated, inside the deadband: no arrow yet…
      const inDeadband = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 2), // 2 m behind
        previousState: 'hidden',
      });
      expect(inDeadband.state).toBe('hidden');

      // …but beyond distanceMax the arrow returns.
      const beyondMax = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 4), // 4 m behind
        previousState: 'hidden',
      });
      expect(beyondMax.state).toBe('arrow');
    });

    it('an ACTIVE off-screen target keeps its turn-around arrow inside the deadband', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 2), // 2 m behind — deadband
        previousState: 'arrow',
      });
      expect(placement.state).toBe('arrow');
    });
  });

  // Why these tests matter: `showArrowWhenInactive` deliberately restores the
  // pre-2026-07-18 "always guide me back" arrow for individual targets (per
  // 2026-07-20-0430-wayfinding-hud-per-target-config-plan.md). The returned
  // `state` MUST stay 'hidden' while it shows — if the seam returned 'arrow',
  // that would become next frame's previousState and flip the reactivation
  // gate from distanceMax back to distanceMin, recreating the exact
  // hysteresis-bypass (ring resurrection) the 2026-07-18 revision fixed.
  // The arrow is therefore a display-only payload on HiddenPlacement.
  describe('showArrowWhenInactive (per-target config, 2026-07-20)', () => {
    const camera = makeCamera();
    const base = {
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
      showArrowWhenInactive: true,
    };

    it('a flagged deactivated off-screen target stays hidden but carries the inactiveArrow payload', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 2), // 2 m BEHIND — deadband
        previousState: 'hidden',
      });
      expect(placement.state).toBe('hidden');
      expect(
        placement.state === 'hidden' && placement.inactiveArrow
      ).toBeTruthy();

      // The payload uses the same edge-arrow math as an active arrow: a
      // behind-the-camera target gets the flipped "turn around" placement.
      const activeArrow = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 2),
        previousState: 'arrow',
      }) as ArrowPlacement;
      if (placement.state !== 'hidden' || !placement.inactiveArrow) {
        throw new Error('expected hidden placement with inactiveArrow');
      }
      expect(placement.inactiveArrow.arrowPosition).toEqual(
        activeArrow.arrowPosition
      );
      expect(placement.inactiveArrow.arrowRotationZ).toBe(
        activeArrow.arrowRotationZ
      );
      expect(placement.inactiveArrow.labelPosition).toEqual(
        activeArrow.labelPosition
      );
    });

    it('a flagged deactivated ON-screen target shows nothing — no payload (you can see the spot)', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -1), // 1 m ahead, on-screen
        previousState: 'hidden',
      });
      expect(placement.state).toBe('hidden');
      expect(
        placement.state === 'hidden' ? placement.inactiveArrow : 'wrong-state'
      ).toBeUndefined();
    });

    it('no-bypass regression: the inactive arrow never flips the reactivation gate back to distanceMin', () => {
      // Frame 1: off-screen inside the deadband → hidden + inactive arrow.
      const offScreen = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 2), // 2 m behind (> distanceMin)
        previousState: 'hidden',
      });
      expect(offScreen.state).toBe('hidden');

      // Frame 2: user turns around — target now ON-screen at 2 m, which is
      // ≥ distanceMin but < distanceMax. Feeding frame 1's returned state
      // forward must keep it hidden (the old bug showed a ring here).
      const onScreen = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -2), // 2 m ahead, on-screen
        previousState: offScreen.state,
      });
      expect(onScreen.state).toBe('hidden');
    });

    it('reactivation at distanceMax is unaffected by the flag', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 4), // 4 m behind ≥ distanceMax
        previousState: 'hidden',
      });
      expect(placement.state).toBe('arrow'); // a real, ACTIVE arrow again
    });

    it('the spawn rule is unchanged: a flagged near spawn shows nothing on its first frame', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, 1), // 1 m behind, no previousState
      });
      expect(placement.state).toBe('hidden');
      expect(
        placement.state === 'hidden' ? placement.inactiveArrow : 'wrong-state'
      ).toBeUndefined();
    });

    it('a degenerate projection (target at the camera) yields hidden without a payload', () => {
      const placement = computeTargetPlacement({
        ...base,
        targetWorldPos: camera.position.clone(),
        previousState: 'hidden',
      });
      expect(placement.state).toBe('hidden');
      expect(
        placement.state === 'hidden' ? placement.inactiveArrow : 'wrong-state'
      ).toBeUndefined();
    });

    it('without the flag (default false) a deactivated off-screen target has no payload', () => {
      const placement = computeTargetPlacement({
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
        targetWorldPos: new THREE.Vector3(0, 0, 2),
        previousState: 'hidden',
      });
      expect(placement.state).toBe('hidden');
      expect(
        placement.state === 'hidden' ? placement.inactiveArrow : 'wrong-state'
      ).toBeUndefined();
    });
  });

  // Why this test matters: a target exactly on the camera plane (w = 0)
  // projects to NaN/±Infinity ndc. The prototype emitted a NaN arrow
  // transform for it; the port deliberately deviates and hides the
  // indicator for that frame (found by the edge-margin property test).
  it('hides a target that sits exactly at the camera position instead of emitting NaN', () => {
    const camera = makeCamera();
    const placement = computeTargetPlacement({
      targetWorldPos: camera.position.clone(),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
      previousState: 'circle',
    });
    expect(placement.state).toBe('hidden');
    expect(placement.onScreen).toBe(false);
    expect(placement.distance).toBe(0);
  });

  // Why these tests matter: the placement seam is a module boundary consumed
  // per frame by the HUD presenter — malformed configuration must fail loudly
  // at the boundary instead of producing NaN transforms three frames later.
  describe('input validation', () => {
    const camera = makeCamera();
    const valid = {
      targetWorldPos: new THREE.Vector3(0, 0, -2),
      camera,
      hudDistance: 2.5,
      distanceMin: 1.5,
      distanceMax: 3.0,
    };

    it('rejects a non-positive or non-finite hudDistance', () => {
      expect(() =>
        computeTargetPlacement({ ...valid, hudDistance: 0 })
      ).toThrow(RangeError);
      expect(() =>
        computeTargetPlacement({ ...valid, hudDistance: Number.NaN })
      ).toThrow(RangeError);
    });

    it('rejects a negative distanceMin and an inverted deadband', () => {
      expect(() =>
        computeTargetPlacement({ ...valid, distanceMin: -1 })
      ).toThrow(RangeError);
      expect(() =>
        computeTargetPlacement({ ...valid, distanceMin: 4, distanceMax: 3 })
      ).toThrow(RangeError);
    });

    it('rejects non-finite deadband bounds', () => {
      expect(() =>
        computeTargetPlacement({
          ...valid,
          distanceMax: Number.POSITIVE_INFINITY,
        })
      ).toThrow(RangeError);
    });
  });
});
