/**
 * The AR sun check's controller (plan 2026-09-24-0100, M2, §3.4 and §8.2).
 *
 * WHY THESE TESTS MATTER. The controller turns rendered frames into a
 * measured heading error, and the plan's review found the two ways that
 * goes quietly wrong: reading a pose one frame older than the one drawn
 * (the recorder's sampler ran before its alignment lerper), and confusing
 * an alignment update mid-Mark with hand shake. So the samples are taken in
 * the marker's onBeforeRender, and the tests drive the REAL scene hierarchy
 * (`createSceneHierarchy`: arWorldGroup → the WebXR→NUE basis node → arpose
 * → camera) with a camera aimed at the true sun through an alignment with a
 * known yaw error, and require that error back. The clock is injected, so
 * nothing here depends on wall time.
 *
 * @vitest-environment jsdom
 */
import { nueToWebXR } from 'gps-plus-slam-js';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { solarPosition } from '../geo/solar-position.js';
import { clearFrameUpdates, runFrameUpdates } from './frame-loop.js';
import { createSceneHierarchy } from './ar-scene-hierarchy.js';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from './session-disposers.js';
import { sunDirectionNue } from './sun-check-geometry.js';
import { SUN_CHECK, startSunCheck, type SunCheckDeps } from './sun-check.js';

const DEG = Math.PI / 180;
const COLOGNE = { lat: 50.94, lng: 6.96 };
/** The golden hour of 23 Sep 2026 at Cologne: a low sun, west-south-west. */
const T0 = Date.UTC(2026, 8, 23, 16, 40, 0);

afterEach(() => {
  clearFrameUpdates();
  clearSessionDisposers();
  vi.useRealTimers();
});

/** An NUE yaw by `deg` clockwise, as the alignment matrix. */
const yawClockwise = (deg: number) =>
  new THREE.Matrix4().makeRotationY(-deg * DEG);

function rig(options: { yawErrorDeg?: number; aligned?: boolean } = {}) {
  const h = createSceneHierarchy();
  let now = T0;
  if (options.aligned !== false) {
    h.arWorldGroup.matrixAutoUpdate = false;
    h.arWorldGroup.matrix.copy(yawClockwise(options.yawErrorDeg ?? 0.5));
  }
  const target = { yaw: 0 as number | null };
  const deps: SunCheckDeps = {
    scene: h.scene,
    arWorldGroup: h.arWorldGroup,
    getZeroReference: () => COLOGNE,
    getTargetYawDeg: () => target.yaw,
    nowEpochMs: () => now,
    monotonicEpochMs: () => now - 1234,
  };
  const check = startSunCheck(deps);
  const sunNow = () => {
    const p = solarPosition(now, COLOGNE.lat, COLOGNE.lng, {
      refraction: true,
    });
    return sunDirectionNue(p.azimuthRad, p.elevationRad);
  };
  /** Aim the camera (in the WebXR frame under arpose) at the TRUE sun, plus a wobble. */
  const aimAtTrueSun = (wobbleYawDeg = 0) => {
    const sun = sunNow();
    const aim = new THREE.PerspectiveCamera();
    aim.lookAt(new THREE.Vector3(...nueToWebXR([...sun])));
    aim.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), wobbleYawDeg * DEG);
    h.camera.quaternion.copy(aim.quaternion);
    h.scene.updateMatrixWorld(true);
  };
  /**
   * One rendered frame at the NEW time: the camera aimed at the true sun
   * then (plus a wobble; null leaves it), the frame update, then the
   * marker's onBeforeRender.
   */
  const frame = (advanceMs = 33, wobbleYawDeg: number | null = 0) => {
    now += advanceMs;
    if (wobbleYawDeg !== null) aimAtTrueSun(wobbleYawDeg);
    runFrameUpdates(advanceMs / 1000, now / 1000);
    h.scene.updateMatrixWorld(true);
    const m = check.marker.object;
    if (m.visible) {
      m.onBeforeRender(
        null as never,
        h.scene,
        h.camera,
        m.geometry,
        m.material as THREE.Material,
        null as never
      );
    }
  };
  return {
    h,
    check,
    frame,
    aimAtTrueSun,
    target,
    setNow: (ms: number) => (now = ms),
    getNow: () => now,
  };
}

describe('the marker follows the real sun', () => {
  // The marker is useless before an alignment exists (arWorldGroup still the
  // identity) and when the sun is well below the horizon.
  it('hides until an alignment exists, and says why', () => {
    const r = rig({ aligned: false });
    r.frame();
    expect(r.check.marker.object.visible).toBe(false);
    expect(r.check.status().hiddenBecause).toBe('no-alignment');
    r.h.arWorldGroup.matrixAutoUpdate = false;
    r.h.arWorldGroup.matrix.copy(yawClockwise(3));
    r.frame(300);
    expect(r.check.marker.object.visible).toBe(true);
  });

  it('hides when the sun is below −1°', () => {
    const r = rig();
    r.setNow(Date.UTC(2026, 8, 23, 20, 0, 0)); // well after dusk
    r.frame(300);
    expect(r.check.marker.object.visible).toBe(false);
    expect(r.check.status().hiddenBecause).toBe('sun-down');
  });

  // Refraction wiring (plan §8.1, moved to M2): the marker shows the
  // APPARENT sun. At a 3° geometric sun the two differ by ~0.23°.
  it('points at the apparent (refracted) sun', () => {
    const r = rig();
    r.frame(300);
    const u = (r.check.marker.object.material as THREE.ShaderMaterial).uniforms;
    const now = r.getNow();
    const apparent = solarPosition(now, COLOGNE.lat, COLOGNE.lng, {
      refraction: true,
    });
    const geometric = solarPosition(now, COLOGNE.lat, COLOGNE.lng);
    expect(u.sunElevationDeg!.value).toBeCloseTo(
      apparent.elevationRad / DEG,
      6
    );
    expect(
      Math.abs(u.sunElevationDeg!.value - geometric.elevationRad / DEG)
    ).toBeGreaterThan(0.1);
  });
});

describe('a Mark measures the heading error', () => {
  // THE CENTRAL CLAIM, through the real hierarchy: a camera aimed at the true
  // sun through an alignment yawed δ reports h = δ and v = 0.
  it('reports the injected yaw error from the second before the press', async () => {
    const r = rig({ yawErrorDeg: 2.5 });
    for (let i = 0; i < 45; i++) {
      r.frame();
    }
    const result = await r.check.mark();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sighting.headingErrDeg).toBeCloseTo(2.5, 4);
    expect(result.sighting.elevationErrDeg).toBeCloseTo(0, 4);
    expect(result.sighting.displayedYawDeg).toBeCloseTo(2.5, 6);
    expect(result.sighting.frames).toBeGreaterThanOrEqual(SUN_CHECK.minFrames);
    // The pre-press window: no sample after the press is used.
    expect(result.sighting.atMs).toBeLessThanOrEqual(r.getNow());
    // The clock offset (review finding 1) is logged, not assumed.
    expect(result.sighting.clockOffsetMs).toBe(1234);
  });

  // Hand shake larger than the spread bound refuses the Mark rather than
  // averaging it into a number.
  it('refuses a Mark taken while the phone moved', async () => {
    const r = rig({ yawErrorDeg: 1 });
    for (let i = 0; i < 45; i++) {
      r.frame(33, i % 2 === 0 ? 1.5 : -1.5);
    }
    expect(await r.check.mark()).toEqual({ ok: false, reason: 'moved' });
  });

  // The spread is measured on the ALIGNMENT-FREE ray (review finding 4): an
  // alignment update mid-window moves the drawn ray without the phone
  // moving, and must be flagged, not refused as shake.
  it('flags an alignment change inside the window instead of calling it shake', async () => {
    const r = rig({ yawErrorDeg: 1 });
    for (let i = 0; i < 45; i++) {
      if (i === 30) {
        r.h.arWorldGroup.matrix.copy(yawClockwise(1.8));
        r.target.yaw = 1.8;
      }
      r.frame();
    }
    const result = await r.check.mark();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('target-changed');
    expect(result.sighting.yawMaxDeg - result.sighting.yawMinDeg).toBeCloseTo(
      0.8,
      4
    );
  });

  // No samples before the press (the check was just switched on): the
  // window starts 300 ms AFTER the press, past the tap's jolt (review
  // finding 5), and the Mark resolves once it is full.
  it('waits past the tap when the second before it is missing', async () => {
    const r = rig({ yawErrorDeg: -1.2 });
    r.frame();
    const pressedAt = r.getNow();
    const pending = r.check.mark();
    for (let i = 0; i < 50; i++) {
      r.frame();
    }
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sighting.windowStartMs).toBeGreaterThanOrEqual(
      pressedAt + SUN_CHECK.joltMs
    );
    expect(result.sighting.headingErrDeg).toBeCloseTo(-1.2, 4);
  });

  it('refuses a second Mark while one is running, and never hangs on disposal', async () => {
    const r = rig();
    r.frame();
    const first = r.check.mark();
    expect(await r.check.mark()).toEqual({ ok: false, reason: 'busy' });
    r.check.dispose();
    expect(await first).toEqual({ ok: false, reason: 'disposed' });
  });

  it('refuses without an alignment or with the sun down', async () => {
    expect(await rig({ aligned: false }).check.mark()).toEqual({
      ok: false,
      reason: 'no-alignment',
    });
    const r = rig();
    r.setNow(Date.UTC(2026, 8, 23, 20, 0, 0));
    r.frame(300);
    expect(await r.check.mark()).toEqual({ ok: false, reason: 'sun-down' });
  });

  it('gives up with "no-frames" when nothing renders', async () => {
    vi.useFakeTimers();
    const r = rig();
    const pending = r.check.mark();
    vi.advanceTimersByTime(
      SUN_CHECK.holdMs + SUN_CHECK.joltMs + SUN_CHECK.giveUpMs
    );
    expect(await pending).toEqual({ ok: false, reason: 'no-frames' });
  });

  it('warns that a high sun resolves heading poorly', async () => {
    const r = rig();
    r.setNow(Date.UTC(2026, 5, 21, 11, 30, 0)); // ~62° at Cologne
    for (let i = 0; i < 45; i++) {
      r.frame();
    }
    const result = await r.check.mark();
    expect(result.ok && result.warnings.includes('high-sun')).toBe(true);
  });
});

describe('the session lifecycle', () => {
  // The controller must not outlive the AR session (the
  // enableArWorldGroupAlignment precedent).
  it('disposes itself with the session and removes its marker', () => {
    const r = rig();
    expect(r.h.scene.children).toContain(r.check.marker.object);
    runSessionDisposers();
    expect(r.h.scene.children).not.toContain(r.check.marker.object);
    // Its frame update is gone too: a frame no longer touches the marker.
    const u = (r.check.marker.object.material as THREE.ShaderMaterial).uniforms;
    const before = u.sunAzimuthDeg!.value;
    r.frame(5000);
    expect(u.sunAzimuthDeg!.value).toBe(before);
  });
});
