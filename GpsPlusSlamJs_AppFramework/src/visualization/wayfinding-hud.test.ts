/**
 * Unit tests for the wayfinding HUD presenter.
 *
 * Why these tests matter:
 * These port the Prototype-2 `ar-wayfinding-hud.test.js` parity suite
 * (AR_Wayfinding_HUD_Component/Task 2, PR #194) onto the framework API per
 * GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md.
 * The prototype exposed imperative waypoint mutations (setWaypoints /
 * addWaypoint / removeWaypoint); the framework presenter polls a single
 * `getTargets` callback per frame (plan decision), so the prototype's
 * state-sync tests are ported as their getter-API equivalents: per-INDEX
 * state, trailing states disposed on shrink, fresh states created on grow.
 * Framework-specific lifecycle (frame-loop registration, session-disposer
 * teardown, idempotent dispose) is covered here too.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import {
  createWayfindingHud,
  validateWayfindingHudOptions,
  DEFAULT_WAYFINDING_HUD,
  type WayfindingHudOptions,
  type WayfindingTarget,
} from './wayfinding-hud.js';
import { clearFrameUpdates, runFrameUpdates } from '../ar/frame-loop.js';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from '../ar/session-disposers.js';

afterEach(() => {
  clearFrameUpdates();
  clearSessionDisposers();
});

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Normalize plain positions into the `WayfindingTarget` shape the clean-break
 * API takes (2026-07-20 per-target config plan) — tests stay terse. */
function toTargets(
  targets: readonly (THREE.Vector3 | WayfindingTarget)[]
): WayfindingTarget[] {
  return targets.map((t) =>
    (t as THREE.Vector3).isVector3
      ? { position: t as THREE.Vector3 }
      : (t as WayfindingTarget)
  );
}

function makeHud(
  targets: (THREE.Vector3 | WayfindingTarget)[],
  overrides?: Partial<WayfindingHudOptions>
) {
  const camera = makeCamera();
  const targetList = toTargets(targets);
  const hud = createWayfindingHud({
    camera,
    getTargets: () => targetList,
    distanceMin: 1.5,
    distanceMax: 3.0,
    hudDistance: 2.5,
    ...overrides,
  });
  return { hud, camera, targetList };
}

function tick(): void {
  runFrameUpdates(1 / 60, 0);
}

function childrenByName(camera: THREE.Camera, name: string): THREE.Object3D[] {
  return camera.children.filter((c) => c.name === name);
}

const visible = (objects: THREE.Object3D[]) => objects.filter((o) => o.visible);

describe('validateWayfindingHudOptions', () => {
  const valid: WayfindingHudOptions = {
    camera: makeCamera(),
    getTargets: () => [],
    distanceMin: 1.5,
    distanceMax: 3.0,
  };

  // Parity with the prototype's constructor-throw test: a config without the
  // required deadband must fail loudly at construction.
  it('rejects missing or malformed distanceMin/distanceMax', () => {
    expect(() =>
      validateWayfindingHudOptions({
        ...valid,
        distanceMin: undefined as unknown as number,
      })
    ).toThrow(/distanceMin/);
    expect(() =>
      validateWayfindingHudOptions({ ...valid, distanceMax: 1.0 })
    ).toThrow(RangeError);
  });

  it('rejects a non-function getTargets and a missing camera', () => {
    expect(() =>
      validateWayfindingHudOptions({
        ...valid,
        getTargets: null as unknown as () => WayfindingTarget[],
      })
    ).toThrow(/getTargets/);
    expect(() =>
      validateWayfindingHudOptions({
        ...valid,
        camera: undefined as unknown as THREE.PerspectiveCamera,
      })
    ).toThrow(/camera/);
  });

  it('rejects non-positive hudDistance and scales', () => {
    expect(() =>
      validateWayfindingHudOptions({ ...valid, hudDistance: 0 })
    ).toThrow(RangeError);
    expect(() =>
      validateWayfindingHudOptions({ ...valid, indicatorScale: -1 })
    ).toThrow(RangeError);
    expect(() =>
      validateWayfindingHudOptions({ ...valid, labelScale: 0 })
    ).toThrow(RangeError);
  });

  it('accepts a valid config and exposes defaults', () => {
    expect(() => validateWayfindingHudOptions(valid)).not.toThrow();
    expect(DEFAULT_WAYFINDING_HUD.hudDistance).toBe(2.5);
    expect(DEFAULT_WAYFINDING_HUD.indicatorScale).toBe(1.0);
    expect(DEFAULT_WAYFINDING_HUD.labelScale).toBe(1.0);
    // The design system's accent (`--accent` in design.css); the repo-config
    // guard `design-accent-copies.test.js` holds this literal to the token.
    expect(DEFAULT_WAYFINDING_HUD.indicatorColor).toBe('#f2971f');
  });

  it('rejects an indicatorColor that is not a colour representation', () => {
    // Why this matters: the tint reaches `new THREE.Color(value)`, which
    // silently yields black for an object or a boolean — a HUD nobody can see
    // over dark ground, with no error anywhere. Fail at construction instead.
    for (const bad of [{}, true, Number.NaN, null]) {
      expect(() =>
        validateWayfindingHudOptions({
          ...valid,
          indicatorColor: bad as unknown as string,
        })
      ).toThrow(TypeError);
    }
    expect(() =>
      validateWayfindingHudOptions({ ...valid, indicatorColor: 0x00ff00 })
    ).not.toThrow();
    expect(() =>
      validateWayfindingHudOptions({
        ...valid,
        indicatorColor: new THREE.Color('#00ff00'),
      })
    ).not.toThrow();
  });
});

describe('createWayfindingHud — procedural indicator look (owner taste round 2026-09-04)', () => {
  function circleMesh(camera: THREE.Camera): THREE.Mesh {
    const [mesh] = visible(childrenByName(camera, 'wayfinding-circle'));
    if (!(mesh as THREE.Mesh | undefined)?.isObject3D) {
      throw new Error('no visible circle');
    }
    return mesh as THREE.Mesh;
  }

  it('tints the procedural ring and cone with the accent by default, and indicatorColor overrides it', () => {
    const { hud, camera } = makeHud([
      new THREE.Vector3(0, 0, -5),
      new THREE.Vector3(10, 0, -5),
    ]);
    tick();
    const ring = circleMesh(camera).material as THREE.MeshBasicMaterial;
    expect(ring.color.getHexString()).toBe('f2971f');
    const [cone] = visible(childrenByName(camera, 'wayfinding-arrow'));
    // One shared material: the cone wears the same tint by construction.
    expect((cone as THREE.Mesh).material).toBe(ring);
    hud.dispose();

    const custom = makeHud([new THREE.Vector3(0, 0, -5)], {
      indicatorColor: '#00ff00',
    });
    tick();
    const material = circleMesh(custom.camera)
      .material as THREE.MeshBasicMaterial;
    expect(material.color.getHexString()).toBe('00ff00');
    custom.hud.dispose();
  });

  it('tags URL-loaded sprite textures as sRGB and leaves a caller-passed texture alone', () => {
    // Why this matters: image files hold sRGB pixels; untagged, three.js
    // samples them as linear and the accent dot in the demo's diamond sprite
    // renders visibly lighter than the CSS it was copied from.
    const { hud, camera } = makeHud([new THREE.Vector3(0, 0, -5)], {
      circleSprite: 'wayfinding-diamond.svg',
    });
    tick();
    const [sprite] = visible(childrenByName(camera, 'wayfinding-circle'));
    const material = (sprite as THREE.Sprite).material;
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    hud.dispose();

    const own = new THREE.Texture();
    const passed = makeHud([new THREE.Vector3(0, 0, -5)], {
      circleSprite: own,
    });
    tick();
    expect(own.colorSpace).toBe(THREE.NoColorSpace);
    passed.hud.dispose();
  });

  it('draws the ring a third as wide as before, keeping its outer radius', () => {
    // The 2026-07 ring was 0.08..0.12 (0.04 wide) in HUD tint; the owner
    // asked for "a third of the thickness" in the accent. Outer radius is what
    // the placement and the pixel e2e were sized against, so it stays.
    const { hud, camera } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();
    const geometry = circleMesh(camera).geometry as THREE.RingGeometry;
    expect(geometry.parameters.outerRadius).toBeCloseTo(0.12, 6);
    expect(geometry.parameters.innerRadius).toBeCloseTo(0.12 - 0.04 / 3, 6);
    hud.dispose();
  });
});

describe('createWayfindingHud — per-frame placement', () => {
  it('shows a circle for an on-screen far target and an arrow for an off-screen one', () => {
    const { hud, camera } = makeHud([
      new THREE.Vector3(0, 0, -5), // on-screen, far -> circle
      new THREE.Vector3(10, 0, -5), // off-screen -> arrow
    ]);
    tick();

    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-label')).length).toBe(2);
    hud.dispose();
  });

  it('hides everything for a close on-screen target ("arrived")', () => {
    const { hud, camera } = makeHud([new THREE.Vector3(0, 0, -0.5)]);
    tick();

    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(0);
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(0);
    expect(visible(childrenByName(camera, 'wayfinding-label')).length).toBe(0);
    hud.dispose();
  });

  // Why this test matters (ported): smoothedCirclePos starts at (0,0,0). If
  // the first circle placement is lerped instead of copied, a newly visible
  // circle renders near the screen center and visibly slides outward over
  // the next frames.
  it('circle indicator snaps to its placement on the first visible frame, then damps', () => {
    // Off-center so the circle position is clearly non-zero in x.
    const { hud, camera } = makeHud([new THREE.Vector3(2, 0, -5)]);
    tick();

    const circle = childrenByName(camera, 'wayfinding-circle')[0]!;
    expect(circle.visible).toBe(true);
    // First visible frame: exactly on the HUD plane at the projected position.
    expect(circle.position.z).toBe(-2.5);
    expect(circle.position.x).toBeGreaterThan(0.5);
    const firstFramePos = circle.position.clone();

    // Subsequent frames damp toward the new placement instead of snapping.
    camera.position.set(0.5, 0, 0);
    camera.updateMatrixWorld(true);
    tick();
    const secondFramePos = circle.position.clone();
    expect(circle.visible).toBe(true);
    expect(secondFramePos).not.toEqual(firstFramePos);

    // Damped: after one frame the mesh must NOT have fully reached the new
    // placement (repeat updates keep moving it in the same direction).
    tick();
    expect(circle.position.clone()).not.toEqual(secondFramePos);
    hud.dispose();
  });

  // Why this test matters: the circle smoothing must be frame-rate aware
  // (alpha = clampedAlpha(rate, dt), lerp-utils idiom — not the prototype's
  // fixed per-frame factor) so a 90 Hz device damps at the same wall-clock
  // speed as a 60 Hz one. A doubled dt must take a ~2× single-frame step.
  it('circle damping scales with dt (frame-rate independence)', () => {
    // One isolated HUD per measurement (disposed before the next is created,
    // so runFrameUpdates never ticks two HUDs at once). Returns the x-step
    // one damped frame of the given dt covers after an identical camera move.
    const measureDampedStep = (dt: number): number => {
      const camera = makeCamera();
      const targets = toTargets([new THREE.Vector3(2, 0, -5)]);
      const hud = createWayfindingHud({
        camera,
        getTargets: () => targets,
        distanceMin: 1.5,
        distanceMax: 3.0,
        hudDistance: 2.5,
      });
      runFrameUpdates(1 / 60, 0); // first visible frame: snap
      camera.position.set(0.5, 0, 0);
      camera.updateMatrixWorld(true);
      const circle = childrenByName(camera, 'wayfinding-circle')[0]!;
      const before = circle.position.x;
      runFrameUpdates(dt, 0); // one damped frame at the measured dt
      const step = circle.position.x - before;
      hud.dispose();
      return step;
    };

    const step60 = measureDampedStep(1 / 60);
    const step30 = measureDampedStep(1 / 30);
    expect(Math.abs(step60)).toBeGreaterThan(0);
    expect(step30 / step60).toBeCloseTo(2, 1);
  });

  it('updates the distance label text through the shared text sprite', () => {
    const { hud, camera } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();

    const label = childrenByName(camera, 'wayfinding-label')[0] as THREE.Sprite;
    expect(label.visible).toBe(true);
    // 5 m away → the label canvas was drawn with "5.0 m"; we can't read the
    // canvas in jsdom, but the sprite must sit at the label position on the
    // HUD plane.
    expect(label.position.z).toBe(-2.5);
    hud.dispose();
  });
});

describe('createWayfindingHud — target-count sync (getter-API port of the prototype state-sync tests)', () => {
  // Why this test matters (ported essence): per-target state is indexed by
  // target. When the getter shrinks, the trailing target's meshes must not
  // hang off the camera forever, and the surviving indices must keep their
  // OWN state objects (no neighbor-state inheritance for the survivors).
  it('disposes trailing per-target state when the target list shrinks', () => {
    const { hud, camera, targetList } = makeHud([
      new THREE.Vector3(0, 0, -5), // index 0: circle
      new THREE.Vector3(10, 0, -5), // index 1: arrow
    ]);
    tick();
    expect(childrenByName(camera, 'wayfinding-arrow').length).toBe(2);

    const circleBefore = childrenByName(camera, 'wayfinding-circle')[0]!;

    targetList.pop(); // shrink to [index 0]
    tick();

    // Trailing state's meshes are detached; index 0 keeps its own objects.
    expect(childrenByName(camera, 'wayfinding-arrow').length).toBe(1);
    expect(childrenByName(camera, 'wayfinding-circle').length).toBe(1);
    expect(childrenByName(camera, 'wayfinding-label').length).toBe(1);
    expect(childrenByName(camera, 'wayfinding-circle')[0]).toBe(circleBefore);
    hud.dispose();
  });

  // Why this test matters (ported essence of the setWaypoints reset test,
  // updated for the 2026-07-18 spawn rule): a target appearing at a NEW
  // index must start from a clean SPAWN state — visible immediately at
  // ≥ distanceMin (even inside the deadband), hidden below it, and never
  // inheriting an earlier target's hysteresis.
  it('creates fresh spawn-state indicators when the target list grows', () => {
    const { hud, camera, targetList } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();

    // New target 2 m away (inside the 1.5/3.0 deadband): the SPAWN rule
    // shows its ring immediately (distance ≥ distanceMin).
    targetList.push({ position: new THREE.Vector3(0, 0.5, -2) });
    // New target 1 m away (below distanceMin): spawns hidden.
    targetList.push({ position: new THREE.Vector3(0, -0.2, -1) });
    tick();

    const circles = childrenByName(camera, 'wayfinding-circle');
    expect(circles.length).toBe(3);
    expect(visible(circles).length).toBe(2); // far target + deadband spawn
    hud.dispose();
  });

  // Why this test matters (ported): removing a target mid-session must not
  // dispose the geometry/material SHARED by the remaining procedural
  // indicators.
  it('keeps shared procedural resources usable for remaining targets after a shrink', () => {
    const { hud, camera, targetList } = makeHud([
      new THREE.Vector3(0, 0, -5),
      new THREE.Vector3(10, 0, -5),
    ]);
    tick();

    const survivorArrow = childrenByName(
      camera,
      'wayfinding-arrow'
    )[0] as THREE.Mesh;
    const geometryDispose = vi.spyOn(survivorArrow.geometry, 'dispose');
    const materialDispose = vi.spyOn(
      survivorArrow.material as THREE.Material,
      'dispose'
    );

    targetList.pop();
    tick();

    // The trailing target's label resources are gone, but the shared
    // procedural geometry/material of the survivor must be untouched.
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();

    // The survivor keeps rendering (state machine still runs).
    expect(childrenByName(camera, 'wayfinding-circle').length).toBe(1);
    hud.dispose();
  });

  // Defensive boundary: a getter that returns garbage must not kill the
  // frame loop (frame-loop already isolates throws, but the HUD should
  // handle it as "no targets" and keep its previous scene state consistent).
  it('treats a non-array getTargets result as an empty target list', () => {
    const targets = toTargets([new THREE.Vector3(0, 0, -5)]);
    let broken = false;
    const camera = makeCamera();
    const hud = createWayfindingHud({
      camera,
      getTargets: () =>
        broken ? (undefined as unknown as WayfindingTarget[]) : targets,
      distanceMin: 1.5,
      distanceMax: 3.0,
    });
    tick();
    expect(childrenByName(camera, 'wayfinding-circle').length).toBe(1);

    broken = true;
    expect(() => tick()).not.toThrow();
    expect(childrenByName(camera, 'wayfinding-circle').length).toBe(0);
    hud.dispose();
  });
});

describe('createWayfindingHud — per-target configuration (2026-07-20 plan)', () => {
  // The presenter logs consumer bugs through log.error → console.error with
  // the '[WayfindingHud]' prefix; counting those calls asserts the
  // "log ONCE per offending key, never per frame" boundary contract.
  function hudErrors(spy: { mock: { calls: unknown[][] } }): number {
    return spy.mock.calls.filter((call) =>
      String(call[0]).includes('WayfindingHud')
    ).length;
  }

  // Why this test matters: per-target state is keyed by `id ?? index`. A
  // consumer returning fresh target literals in a different order each call
  // (sorting, filtering upstream) must NOT leak one target's hysteresis
  // state into another. Distances are chosen so index keying would visibly
  // differ: after the swap the deactivated target's state would land on the
  // in-deadband target and hide it (0 visible) instead of keeping 1 visible.
  it('id keying: per-target hysteresis state follows the id through a reorder', () => {
    const near: WayfindingTarget = {
      id: 'near',
      position: new THREE.Vector3(0, 0, -1), // < distanceMin → spawns hidden
    };
    const deadband: WayfindingTarget = {
      id: 'deadband',
      position: new THREE.Vector3(0, 0.3, -2.5), // in 1.5/3.0 → spawns circle
    };
    const { hud, camera, targetList } = makeHud([near, deadband]);
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);

    // Same targets, swapped order: states must stick to their ids.
    targetList.length = 0;
    targetList.push(deadband, near);
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    hud.dispose();
  });

  it('per-target distanceMin/distanceMax override the HUD-level options', () => {
    // 4 m away: the HUD deadband (1.5/3.0) would show a ring on spawn, but
    // the target's own distanceMin: 5 marks it as "arrived" territory.
    const { hud, camera } = makeHud([
      {
        id: 'strict',
        position: new THREE.Vector3(0, 0, -4),
        distanceMin: 5,
        distanceMax: 6,
      },
      { id: 'default', position: new THREE.Vector3(0, 0.3, -5) },
    ]);
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    hud.dispose();
  });

  // Why this test matters: the clean-break migration error. A consumer still
  // returning plain Vector3s must get ONE clear error naming the new shape —
  // not a per-frame throw that kills the host render loop, and not silence.
  it('rejects a legacy plain-Vector3 element with one migration error; other targets keep working', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Deliberately NOT via makeHud/toTargets: this simulates an unmigrated
    // consumer whose getter still returns raw Vector3 elements.
    const targets = [
      { id: 'ok', position: new THREE.Vector3(0, 0.3, -5) },
      new THREE.Vector3(0, 0, -5) as unknown as WayfindingTarget,
    ];
    const camera = makeCamera();
    const hud = createWayfindingHud({
      camera,
      getTargets: () => targets,
      distanceMin: 1.5,
      distanceMax: 3.0,
      hudDistance: 2.5,
    });
    tick();
    tick();

    // Only the valid target got indicators; the legacy element is skipped.
    expect(childrenByName(camera, 'wayfinding-circle').length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    expect(hudErrors(errorSpy)).toBe(1); // once, not per frame
    hud.dispose();
    errorSpy.mockRestore();
  });

  it('a duplicate id within one result logs once and only the first occurrence is shown', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hud, camera } = makeHud([
      { id: 'twin', position: new THREE.Vector3(0, 0.3, -5) }, // circle
      { id: 'twin', position: new THREE.Vector3(10, 0, -5) }, // would be arrow
    ]);
    tick();
    tick();

    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(0);
    expect(hudErrors(errorSpy)).toBe(1);
    hud.dispose();
    errorSpy.mockRestore();
  });

  it('an invalid per-target deadband hides that target (one log) until it becomes valid', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hud, camera, targetList } = makeHud([
      {
        id: 'bad',
        position: new THREE.Vector3(0, 0.3, -5),
        distanceMin: 3,
        distanceMax: 1, // inverted — same 0 ≤ min ≤ max rule as the seam
      },
    ]);
    tick();
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(0);
    expect(hudErrors(errorSpy)).toBe(1);

    // Healing the config brings the target back (fresh spawn semantics).
    targetList[0] = {
      id: 'bad',
      position: new THREE.Vector3(0, 0.3, -5),
      distanceMin: 1.5,
      distanceMax: 3,
    };
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    hud.dispose();
    errorSpy.mockRestore();
  });

  // Why this test matters: the per-target parity opt-in. A deactivated
  // flagged target must show the edge arrow (+ label by default) when
  // off-screen, nothing when on-screen — and coming on-screen inside the
  // deadband must NOT resurrect the ring (2026-07-18 no-bypass rule).
  it('showArrowWhenInactive: renders the inactive edge arrow with label; no ring on-screen', () => {
    const target: WayfindingTarget = {
      id: 'exit',
      position: new THREE.Vector3(0, 0, 1), // 1 m BEHIND → off-screen, < min
      showArrowWhenInactive: true,
    };
    const { hud, camera, targetList } = makeHud([target]);
    tick(); // spawn frame: below distanceMin → hidden, no payload yet
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(0);

    tick(); // deactivated + off-screen → inactive arrow + label
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(0);
    expect(visible(childrenByName(camera, 'wayfinding-label')).length).toBe(1);

    // Turn around: target on-screen at 2 m (deadband) — still deactivated,
    // so NOTHING shows (no ring resurrection through the presenter path).
    targetList[0] = { ...target, position: new THREE.Vector3(0, 0, -2) };
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(0);
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(0);
    expect(visible(childrenByName(camera, 'wayfinding-label')).length).toBe(0);
    hud.dispose();
  });

  it('showLabelWhenInactive: false renders the inactive arrow without its label', () => {
    const { hud, camera } = makeHud([
      {
        id: 'quiet',
        position: new THREE.Vector3(0, 0, 1),
        showArrowWhenInactive: true,
        showLabelWhenInactive: false,
      },
    ]);
    tick(); // spawn (hidden)
    tick(); // inactive arrow frame
    expect(visible(childrenByName(camera, 'wayfinding-arrow')).length).toBe(1);
    expect(visible(childrenByName(camera, 'wayfinding-label')).length).toBe(0);
    hud.dispose();
  });
});

describe('createWayfindingHud — explicit-tick mode (autoRegisterFrameUpdate: false)', () => {
  // Why these tests matter: outside a WebXR session nothing ticks the
  // framework frame loop (runFrameUpdates is session-internal), so
  // desktop hosts (walk simulators, replay scenes) own their own rAF and
  // must be able to drive the HUD directly via handle.update(dt).
  it('is not driven by the frame loop; handle.update(dt) drives placement instead', () => {
    const camera = makeCamera();
    const targets = toTargets([new THREE.Vector3(0, 0, -5)]);
    const hud = createWayfindingHud({
      camera,
      getTargets: () => targets,
      distanceMin: 1.5,
      distanceMax: 3.0,
      autoRegisterFrameUpdate: false,
    });

    // The framework frame loop must NOT tick this HUD…
    tick();
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(0);

    // …the host's explicit update does.
    hud.update(1 / 60);
    expect(visible(childrenByName(camera, 'wayfinding-circle')).length).toBe(1);
    hud.dispose();
  });

  it('update(dt) applies dt to the circle damping and dispose() stays complete', () => {
    const camera = makeCamera();
    const targets = toTargets([new THREE.Vector3(2, 0, -5)]);
    const hud = createWayfindingHud({
      camera,
      getTargets: () => targets,
      distanceMin: 1.5,
      distanceMax: 3.0,
      autoRegisterFrameUpdate: false,
    });
    hud.update(1 / 60); // snap frame
    camera.position.set(0.5, 0, 0);
    camera.updateMatrixWorld(true);
    const circle = childrenByName(camera, 'wayfinding-circle')[0]!;
    const before = circle.position.x;
    hud.update(1 / 60); // damped frame
    expect(circle.position.x).not.toBe(before);

    hud.dispose();
    expect(camera.children.length).toBe(0);
    expect(() => hud.update(1 / 60)).not.toThrow(); // post-dispose tick is a no-op
    expect(camera.children.length).toBe(0);
  });
});

describe('createWayfindingHud — lifecycle', () => {
  it('dispose detaches all HUD objects from the camera and unregisters the frame tick', () => {
    const { hud, camera } = makeHud([
      new THREE.Vector3(0, 0, -5),
      new THREE.Vector3(10, 0, -5),
    ]);
    tick();
    expect(camera.children.length).toBeGreaterThan(0);

    hud.dispose();
    expect(camera.children.length).toBe(0);

    // No further ticks: nothing gets re-attached.
    tick();
    expect(camera.children.length).toBe(0);
  });

  it('dispose is idempotent', () => {
    const { hud } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();
    hud.dispose();
    expect(() => hud.dispose()).not.toThrow();
  });

  // Why this test matters: the HUD self-registers with the session-disposer
  // registry (like enableArWorldGroupAlignment), so `resetWebXRState()`
  // tears it down even when the app never holds the handle.
  it('session teardown (runSessionDisposers) disposes the HUD', () => {
    const { camera } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();
    expect(camera.children.length).toBeGreaterThan(0);

    runSessionDisposers();
    expect(camera.children.length).toBe(0);
  });

  it('dispose releases label material/texture resources', () => {
    const { hud, camera } = makeHud([new THREE.Vector3(0, 0, -5)]);
    tick();

    const label = childrenByName(camera, 'wayfinding-label')[0] as THREE.Sprite;
    const materialDispose = vi.spyOn(label.material, 'dispose');
    const textureDispose = vi.spyOn(label.material.map!, 'dispose');

    hud.dispose();
    expect(materialDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
  });
});
