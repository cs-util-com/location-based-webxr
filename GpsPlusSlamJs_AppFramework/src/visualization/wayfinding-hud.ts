/**
 * Wayfinding HUD presenter — frustum-locked target indicators as camera
 * children.
 *
 * Framework graduation of the field-validated Prototype-2 `ARWayfindingHUD`
 * (AR_Wayfinding_HUD_Component/Task 2, PR #194), per
 * `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md`.
 * Each target gets an arrow/circle indicator pair plus a distance label,
 * driven per frame by the pure placement seam (`wayfinding-placement.ts`).
 *
 * Key deltas vs. the prototype (all recorded in the plan's decisions):
 * - Targets come from a single `getTargets()` callback polled each frame —
 *   no imperative setWaypoints/addWaypoint/removeWaypoint API. Since the
 *   2026-07-20 per-target config plan the callback returns
 *   `WayfindingTarget[]` (position + optional id / per-target deadband /
 *   inactive-arrow opt-in); per-target state is keyed by `id ?? index`.
 * - The camera is an explicit required option and is NEVER reparented
 *   (the prototype's `scene.add(camera)` would destroy the framework's
 *   arWorldGroup → basisChangeNode → arpose → camera alignment chain).
 *   Indicators are added TO the camera; the camera is not moved.
 * - No renderer handle: placement always reads the projection matrix
 *   (exact for any symmetric-frustum perspective camera, and in-session
 *   the matrix is the only truthful source — fov/aspect are stale there).
 * - Self-registers with the frame loop and the session-disposer registry,
 *   so `resetWebXRState()` tears it down even if the app drops the handle.
 */

import * as THREE from 'three';
import { registerFrameUpdate } from '../ar/frame-loop.js';
import { registerSessionDisposer } from '../ar/session-disposers.js';
import { clampedAlpha } from './lerp-utils.js';
import { createTextSprite, type TextSprite } from './text-sprite.js';
import {
  createTargetResolver,
  type ResolvedTarget,
  type WayfindingTarget,
} from './wayfinding-targets.js';
import {
  computeTargetPlacement,
  type ArrowPlacement,
  type CirclePlacement,
  type InactiveArrowPlacement,
  type TargetPlacementState,
} from './wayfinding-placement.js';

export type { WayfindingTarget } from './wayfinding-targets.js';

export interface WayfindingHudOptions {
  /**
   * The framework's logical camera (`getCamera()` from the `ar` module).
   * The HUD attaches its indicators as children of this camera; create the
   * HUD after the AR session started and dispose it when the session ends
   * (session teardown also disposes it automatically).
   */
  camera: THREE.PerspectiveCamera;
  /**
   * Polled once per frame; returns the current targets. Per-target state is
   * keyed by `id ?? index`: give targets stable ids whenever the array can
   * reorder or is rebuilt from fresh literals each call — state then follows
   * the id. Without ids, state sticks to the array position (an identity
   * change at a constant index is not detected). States whose key vanishes
   * from the result are disposed.
   *
   * Defensive boundary (the getter runs inside the frame loop, so consumer
   * bugs must never become per-frame throws): a non-array result counts as
   * "no targets"; an invalid element (wrong shape, legacy plain `Vector3`,
   * duplicate id, deadband violating `0 ≤ min ≤ max`) is hidden and
   * reported via `log.error` ONCE per offending key, until it heals.
   */
  getTargets: () => WayfindingTarget[];
  /** Distance (m) below which a visible indicator hides ("arrived").
   * Per-target `distanceMin` overrides this. */
  distanceMin: number;
  /** Distance (m) a hidden target must reach before it reactivates.
   * Per-target `distanceMax` overrides this. */
  distanceMax: number;
  /** Distance (m) of the HUD plane in front of the camera. Default 2.5. */
  hudDistance?: number;
  /** Uniform scale multiplier for arrow/circle indicators. Default 1.0. */
  indicatorScale?: number;
  /** Uniform scale multiplier for distance labels. Default 1.0. */
  labelScale?: number;
  /**
   * Optional custom texture (or URL) for the directional arrow indicator;
   * a procedural cone is used when omitted. The asset must point UPWARD
   * (12 o'clock) and be centered — the rotation logic assumes it.
   * A URL-loaded texture is owned (and disposed) by the HUD; a passed-in
   * `THREE.Texture` instance stays owned by the caller.
   */
  arrowSprite?: THREE.Texture | string;
  /** Optional custom texture (or URL) for the on-screen ring indicator;
   * a procedural ring is used when omitted. Same ownership rule as
   * `arrowSprite`. */
  circleSprite?: THREE.Texture | string;
  /**
   * When `true` (default) the HUD self-registers with the framework frame
   * loop and is ticked by the WebXR session. Set `false` for hosts that own
   * their own render loop (desktop simulators, replay scenes — nothing
   * ticks the frame loop outside a session) and drive the HUD via
   * {@link WayfindingHud.update} instead. Either/or: do not combine
   * auto-registration with manual `update` calls (double-tick).
   */
  autoRegisterFrameUpdate?: boolean;
}

/** Defaults for the optional {@link WayfindingHudOptions} fields. */
export const DEFAULT_WAYFINDING_HUD = {
  hudDistance: 2.5,
  indicatorScale: 1.0,
  labelScale: 1.0,
} as const;

export interface WayfindingHud {
  /**
   * Explicit per-frame tick for hosts that own their render loop — only
   * meaningful with `autoRegisterFrameUpdate: false` (see that option).
   * No-op after dispose().
   */
  update(dt: number): void;
  /** Detach and release everything. Idempotent; also runs on session end. */
  dispose(): void;
}

/** Indicator tint used by the procedural cone/ring fallbacks. */
const HUD_COLOR = 0xff3b30;
/**
 * Damping rate for the circle's snap-then-damp smoothing, consumed as
 * `clampedAlpha(CIRCLE_DAMPING_RATE, dt)` (lerp-utils idiom) so the damping
 * speed is frame-rate independent. 9 reproduces the field-validated
 * prototype's fixed 0.15-per-frame factor at 60 fps.
 */
const CIRCLE_DAMPING_RATE = 9;

function assertPositiveFiniteOption(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `createWayfindingHud: ${name} must be a positive finite number, got ${value}`
    );
  }
}

function validateHudRefs(options: WayfindingHudOptions): void {
  if (!options.camera?.isPerspectiveCamera) {
    throw new TypeError(
      'createWayfindingHud: camera must be a THREE.PerspectiveCamera (the ar module getCamera() result)'
    );
  }
  if (typeof options.getTargets !== 'function') {
    throw new TypeError(
      'createWayfindingHud: getTargets must be a function returning WayfindingTarget[]'
    );
  }
}

/** The required deadband mirrors the prototype's strict constructor contract. */
function validateHudDeadband(distanceMin: number, distanceMax: number): void {
  if (
    typeof distanceMin !== 'number' ||
    !Number.isFinite(distanceMin) ||
    distanceMin < 0
  ) {
    throw new RangeError(
      `createWayfindingHud: distanceMin must be a non-negative finite number, got ${distanceMin}`
    );
  }
  if (
    typeof distanceMax !== 'number' ||
    !Number.isFinite(distanceMax) ||
    distanceMax < distanceMin
  ) {
    throw new RangeError(
      `createWayfindingHud: distanceMax must be finite and ≥ distanceMin (${distanceMin}), got ${distanceMax}`
    );
  }
}

/**
 * Validate a {@link WayfindingHudOptions} object. Throws `TypeError` /
 * `RangeError` on malformed input.
 */
export function validateWayfindingHudOptions(
  options: WayfindingHudOptions
): void {
  validateHudRefs(options);
  validateHudDeadband(options.distanceMin, options.distanceMax);
  assertPositiveFiniteOption(
    'hudDistance',
    options.hudDistance ?? DEFAULT_WAYFINDING_HUD.hudDistance
  );
  assertPositiveFiniteOption(
    'indicatorScale',
    options.indicatorScale ?? DEFAULT_WAYFINDING_HUD.indicatorScale
  );
  assertPositiveFiniteOption(
    'labelScale',
    options.labelScale ?? DEFAULT_WAYFINDING_HUD.labelScale
  );
}

interface ResolvedTexture {
  texture: THREE.Texture;
  /** True when the HUD loaded it from a URL and therefore owns/disposes it. */
  owned: boolean;
}

function resolveTexture(
  source: THREE.Texture | string | undefined
): ResolvedTexture | null {
  if (source === undefined) return null;
  if (typeof source === 'string') {
    return { texture: new THREE.TextureLoader().load(source), owned: true };
  }
  return { texture: source, owned: false };
}

interface TargetState {
  /** null = freshly created, no frame yet — the placement seam applies its
   * SPAWN rule (visible at distanceMin) instead of the reactivation rule. */
  currentState: TargetPlacementState | null;
  arrow: THREE.Mesh | THREE.Sprite;
  circle: THREE.Mesh | THREE.Sprite;
  label: TextSprite;
  smoothedCirclePos: THREE.Vector3;
}

/**
 * Create the wayfinding HUD and start driving it via the frame loop.
 *
 * Follows the `createGpsCompassCubes` / `enableArWorldGroupAlignment`
 * idiom: factory + handle, frame-loop registration at construction,
 * self-disposal on session teardown.
 */
export function createWayfindingHud(
  options: WayfindingHudOptions
): WayfindingHud {
  validateWayfindingHudOptions(options);

  const { camera, getTargets, distanceMin, distanceMax } = options;
  const hudDistance = options.hudDistance ?? DEFAULT_WAYFINDING_HUD.hudDistance;
  const indicatorScale =
    options.indicatorScale ?? DEFAULT_WAYFINDING_HUD.indicatorScale;
  const labelScale = options.labelScale ?? DEFAULT_WAYFINDING_HUD.labelScale;

  const arrowTexture = resolveTexture(options.arrowSprite);
  const circleTexture = resolveTexture(options.circleSprite);

  // Shared procedural resources, created lazily on first use and released
  // only in dispose() — per-target teardown must not touch them.
  let arrowGeometry: THREE.ConeGeometry | null = null;
  let circleGeometry: THREE.RingGeometry | null = null;
  let hudMaterial: THREE.MeshBasicMaterial | null = null;

  // Per-target state keyed by `id ?? index` (2026-07-20 plan) — replaces the
  // earlier grow/shrink array, so state follows ids through reorders.
  const states = new Map<string | number, TargetState>();

  // Boundary triage of getTargets() results: hide-and-log-once, never a
  // per-frame throw. Pure, tested directly in wayfinding-targets.test.ts.
  const targets = createTargetResolver({ distanceMin, distanceMax });

  function getHudMaterial(): THREE.MeshBasicMaterial {
    hudMaterial ??= new THREE.MeshBasicMaterial({
      color: HUD_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    return hudMaterial;
  }

  function makeIndicatorSprite(texture: THREE.Texture): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    sprite.scale.set(0.3 * indicatorScale, 0.3 * indicatorScale, 1);
    sprite.visible = false;
    return sprite;
  }

  function makeArrow(): THREE.Mesh | THREE.Sprite {
    if (arrowTexture) return makeIndicatorSprite(arrowTexture.texture);
    if (!arrowGeometry) {
      arrowGeometry = new THREE.ConeGeometry(
        0.1 * indicatorScale,
        0.3 * indicatorScale,
        16
      );
      arrowGeometry.translate(0, 0.15 * indicatorScale, 0);
    }
    const mesh = new THREE.Mesh(arrowGeometry, getHudMaterial());
    mesh.renderOrder = 999;
    mesh.visible = false;
    return mesh;
  }

  function makeCircle(): THREE.Mesh | THREE.Sprite {
    if (circleTexture) return makeIndicatorSprite(circleTexture.texture);
    circleGeometry ??= new THREE.RingGeometry(
      0.08 * indicatorScale,
      0.12 * indicatorScale,
      32
    );
    const mesh = new THREE.Mesh(circleGeometry, getHudMaterial());
    mesh.renderOrder = 999;
    mesh.visible = false;
    return mesh;
  }

  function makeLabel(): TextSprite {
    const scale = hudDistance * labelScale;
    const label = createTextSprite({
      canvasWidth: 256,
      canvasHeight: 128,
      font: 'bold 48px Arial, sans-serif',
      background: 'pill',
      depthWrite: false,
      transparent: true,
      linearFilters: true,
      renderOrder: 1000,
      scale: { x: 0.16 * scale, y: 0.08 * scale, z: 1 },
    });
    label.sprite.visible = false;
    return label;
  }

  function makeState(): TargetState {
    const arrow = makeArrow();
    arrow.name = 'wayfinding-arrow';
    const circle = makeCircle();
    circle.name = 'wayfinding-circle';
    const label = makeLabel();
    label.sprite.name = 'wayfinding-label';

    camera.add(arrow);
    camera.add(circle);
    camera.add(label.sprite);

    return {
      currentState: null,
      arrow,
      circle,
      label,
      smoothedCirclePos: new THREE.Vector3(),
    };
  }

  /** Detach one indicator and release its PER-TARGET resources only —
   * shared procedural geometry/material stay alive for the other targets. */
  function disposeIndicator(indicator: THREE.Mesh | THREE.Sprite): void {
    camera.remove(indicator);
    if ((indicator as THREE.Sprite).isSprite) {
      // Sprite materials are per target; the sprite GEOMETRY is three.js's
      // global shared plane — never dispose it (prototype bug fixed here).
      (indicator as THREE.Sprite).material.dispose();
    }
  }

  function disposeState(state: TargetState): void {
    disposeIndicator(state.arrow);
    disposeIndicator(state.circle);
    camera.remove(state.label.sprite);
    state.label.dispose();
  }

  /** Create states for new keys and dispose states whose key vanished from
   * the (validated) target list — getter-API replacement for the prototype's
   * addWaypoint/removeWaypoint mutations, see the sidecar. */
  function syncTargetStates(resolved: readonly ResolvedTarget[]): void {
    const liveKeys = new Set(resolved.map((target) => target.key));
    for (const [key, state] of states) {
      if (!liveKeys.has(key)) {
        disposeState(state);
        states.delete(key);
      }
    }
    for (const target of resolved) {
      if (!states.has(target.key)) {
        states.set(target.key, makeState());
      }
    }
  }

  function hideAll(state: TargetState): void {
    state.arrow.visible = false;
    state.circle.visible = false;
    state.label.sprite.visible = false;
  }

  function showCircle(
    state: TargetState,
    placement: CirclePlacement,
    previous: TargetPlacementState | null,
    dt: number
  ): void {
    state.arrow.visible = false;
    state.circle.visible = true;

    // Snap to the placement on the frame the circle becomes visible;
    // damping only applies BETWEEN circle frames (smoothedCirclePos would
    // otherwise lerp in from its stale/zero value).
    if (previous !== 'circle') {
      state.smoothedCirclePos.copy(placement.circlePosition);
    } else {
      state.smoothedCirclePos.lerp(
        placement.circlePosition,
        clampedAlpha(CIRCLE_DAMPING_RATE, dt)
      );
    }
    state.circle.position.copy(state.smoothedCirclePos);
  }

  function positionArrow(
    state: TargetState,
    arrowPosition: THREE.Vector3,
    arrowRotationZ: number
  ): void {
    state.circle.visible = false;
    state.arrow.visible = true;
    state.arrow.position.copy(arrowPosition);
    if ((state.arrow as THREE.Sprite).isSprite) {
      (state.arrow as THREE.Sprite).material.rotation = arrowRotationZ;
    } else {
      state.arrow.rotation.set(0, 0, arrowRotationZ);
    }
  }

  function showArrow(state: TargetState, placement: ArrowPlacement): void {
    positionArrow(state, placement.arrowPosition, placement.arrowRotationZ);
  }

  /** The per-target parity opt-in: draw the display-only inactive arrow (the
   * hysteresis state stays 'hidden' — see the seam sidecar's no-bypass
   * invariant), with the label gated by `showLabelWhenInactive`. */
  function showInactiveArrow(
    state: TargetState,
    payload: InactiveArrowPlacement,
    distanceLabel: string,
    showLabel: boolean
  ): void {
    positionArrow(state, payload.arrowPosition, payload.arrowRotationZ);
    if (!showLabel) {
      state.label.sprite.visible = false;
      return;
    }
    state.label.setText(distanceLabel);
    state.label.sprite.position.copy(payload.labelPosition);
    state.label.sprite.visible = true;
  }

  function updateTarget(
    target: ResolvedTarget,
    state: TargetState,
    dt: number
  ): void {
    const placement = computeTargetPlacement({
      targetWorldPos: target.position,
      camera,
      hudDistance,
      distanceMin: target.distanceMin,
      distanceMax: target.distanceMax,
      showArrowWhenInactive: target.showArrowWhenInactive,
      // Omit previousState on the very first frame — the seam then applies
      // its SPAWN rule (visible at distanceMin, not the distanceMax
      // reactivation gate).
      ...(state.currentState !== null
        ? { previousState: state.currentState }
        : {}),
      // Always read the projection matrix: exact for any symmetric-frustum
      // perspective camera, and in-session it is the only truthful source
      // (WebXR owns the projection; fov/aspect are stale).
      isXrSession: true,
    });

    const previous = state.currentState;
    state.currentState = placement.state;

    if (placement.state === 'hidden') {
      if (placement.inactiveArrow) {
        showInactiveArrow(
          state,
          placement.inactiveArrow,
          placement.distanceLabel,
          target.showLabelWhenInactive
        );
      } else {
        hideAll(state);
      }
      return;
    }

    state.label.setText(placement.distanceLabel);
    state.label.sprite.position.copy(placement.labelPosition);
    state.label.sprite.visible = true;

    if (placement.state === 'circle') {
      showCircle(state, placement, previous, dt);
      return;
    }
    showArrow(state, placement);
  }

  function update(dt: number): void {
    const resolved = targets.resolve(getTargets());
    syncTargetStates(resolved);
    for (const target of resolved) {
      updateTarget(target, states.get(target.key) as TargetState, dt);
    }
  }

  /** Release the target-shared procedural resources and any owned textures. */
  function releaseSharedResources(): void {
    arrowGeometry?.dispose();
    circleGeometry?.dispose();
    hudMaterial?.dispose();
    if (arrowTexture?.owned) arrowTexture.texture.dispose();
    if (circleTexture?.owned) circleTexture.texture.dispose();
  }

  const unregister =
    (options.autoRegisterFrameUpdate ?? true)
      ? registerFrameUpdate(update)
      : null;

  let disposed = false;
  const handle: WayfindingHud = {
    update(dt: number): void {
      // Guard: an update after dispose would re-create per-target state
      // from getTargets() and silently re-attach meshes to the camera.
      if (disposed) return;
      update(dt);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unregister?.();
      for (const state of states.values()) {
        disposeState(state);
      }
      states.clear();
      releaseSharedResources();
      // Remove ourselves from the session registry so the teardown flush
      // won't re-run this (and an early manual dispose leaves no dead entry).
      deregisterSessionDisposer();
    },
  };

  // Auto-dispose on session teardown so callers never have to hold the
  // handle (enableArWorldGroupAlignment idiom).
  const deregisterSessionDisposer = registerSessionDisposer(() =>
    handle.dispose()
  );

  return handle;
}
