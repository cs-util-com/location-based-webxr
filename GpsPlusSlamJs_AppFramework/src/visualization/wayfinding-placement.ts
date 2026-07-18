/**
 * Wayfinding placement seam — the pure math behind the wayfinding HUD.
 *
 * TypeScript port of the field-validated Prototype-2 `hud-placement.js`
 * (AR_Wayfinding_HUD_Component/Task 2, PR #194), per the graduation plan
 * `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md`.
 *
 * Computes, for one target and one camera, a view-model placement
 * (`hidden` | `circle` | `arrow`) on a HUD plane at `hudDistance` in front of
 * the camera. No three.js scene objects, no renderer, no DOM — the camera is
 * an explicit argument (frustum-visibility precedent), which is what keeps
 * this seam pure and lets a DOM presenter reuse it later without API changes.
 *
 * The prototype's `getEvaluationCamera` (renderer.xr sub-camera resolution)
 * is deliberately NOT ported: callers pass the framework's logical
 * `getCamera()` camera instead (mono-camera decision, plan §decisions).
 */

import * as THREE from 'three';

/** Indicator state for one target. */
export type TargetPlacementState = 'hidden' | 'circle' | 'arrow';

export interface TargetPlacementInput {
  /** The target's world position. */
  targetWorldPos: THREE.Vector3;
  /** The camera to evaluate against (the framework's logical camera). */
  camera: THREE.PerspectiveCamera;
  /** Distance (m) of the HUD plane in front of the camera. Must be > 0. */
  hudDistance: number;
  /** Distance (m) below which a visible indicator hides ("arrived"). */
  distanceMin: number;
  /**
   * Distance (m) a hidden target must reach before its indicator
   * reactivates. Together with distanceMin this forms a hysteresis deadband
   * that prevents flicker at the distanceMin boundary. Must be ≥ distanceMin.
   */
  distanceMax: number;
  /**
   * The target's state from the previous frame. OMIT for a freshly spawned
   * target — spawn visibility is `distance ≥ distanceMin`. Passing
   * `'hidden'` means "deactivated" (arrived / spawned too close) and
   * requires `distance ≥ distanceMax` to reactivate — regardless of view
   * direction (2026-07-18 revision).
   */
  previousState?: TargetPlacementState;
  /**
   * Read the frustum extents from the projection matrix instead of
   * fov/aspect (required in-session, where WebXR owns the projection).
   * Defaults to false.
   */
  isXrSession?: boolean;
  /** NDC limit while an arrow is showing (arrow→circle hysteresis). */
  viewportInner?: number;
  /** NDC limit while no arrow is showing (circle→arrow hysteresis). */
  viewportOuter?: number;
  /** Fraction of the half-extents the arrow is inset to. In (0, 1]. */
  edgeMargin?: number;
}

interface TargetPlacementBase {
  onScreen: boolean;
  isBehind: boolean;
  /** Camera-to-target distance in meters. */
  distance: number;
  /** Human-readable distance, e.g. "12.3 m". */
  distanceLabel: string;
  /** The target's normalized device coordinates. */
  ndc: THREE.Vector3;
  /** Physical width of the frustum at the HUD plane, in meters. */
  frustumWidth: number;
  /** Physical height of the frustum at the HUD plane, in meters. */
  frustumHeight: number;
}

export interface HiddenPlacement extends TargetPlacementBase {
  state: 'hidden';
}

export interface CirclePlacement extends TargetPlacementBase {
  state: 'circle';
  /** Circle position on the HUD plane, in camera-local coordinates. */
  circlePosition: THREE.Vector3;
  /** Distance-label position, slightly below the circle. */
  labelPosition: THREE.Vector3;
}

export interface ArrowPlacement extends TargetPlacementBase {
  state: 'arrow';
  /** Arrow position on the edge-margin rectangle, camera-local. */
  arrowPosition: THREE.Vector3;
  /** Z rotation for an upward-pointing arrow asset, in radians. */
  arrowRotationZ: number;
  /** Distance-label position, inset from the arrow toward the center. */
  labelPosition: THREE.Vector3;
}

export type TargetPlacement =
  | HiddenPlacement
  | CirclePlacement
  | ArrowPlacement;

const DEFAULT_VIEWPORT_INNER = 0.95;
const DEFAULT_VIEWPORT_OUTER = 1.0;
const DEFAULT_EDGE_MARGIN = 0.9;

/** Formats a numeric distance (meters) into a readable label, e.g. "1.5 m". */
export function formatDistanceLabel(distance: number): string {
  return `${distance.toFixed(1)} m`;
}

/**
 * Physical width/height of the camera frustum at `hudDistance`.
 *
 * In an XR session the projection matrix is owned by WebXR and the camera's
 * fov/aspect fields are stale — read the extents from the matrix directly.
 */
export function getHudFrustumExtents(
  camera: THREE.PerspectiveCamera,
  hudDistance: number,
  isXrSession = false
): { width: number; height: number } {
  if (!Number.isFinite(hudDistance) || hudDistance <= 0) {
    throw new RangeError(
      `getHudFrustumExtents: hudDistance must be a positive finite number, got ${hudDistance}`
    );
  }

  if (isXrSession) {
    const elements = camera.projectionMatrix.elements;
    const tanHalfFovY = 1.0 / elements[5];
    const tanHalfFovX = 1.0 / elements[0];

    return {
      width: 2.0 * hudDistance * tanHalfFovX,
      height: 2.0 * hudDistance * tanHalfFovY,
    };
  }

  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const height = 2.0 * hudDistance * Math.tan(fovRad / 2.0);

  return {
    width: height * camera.aspect,
    height,
  };
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `computeTargetPlacement: ${name} must be a positive finite number, got ${value}`
    );
  }
}

/** TargetPlacementInput with every defaultable field resolved.
 * `previousState` is deliberately NOT defaulted — its absence is meaningful
 * (a fresh spawn, gated at distanceMin rather than distanceMax). */
type ResolvedPlacementInput = Required<
  Omit<TargetPlacementInput, 'previousState'>
> &
  Pick<TargetPlacementInput, 'previousState'>;

function resolvePlacementInput(
  input: TargetPlacementInput
): ResolvedPlacementInput {
  return {
    ...input,
    isXrSession: input.isXrSession ?? false,
    viewportInner: input.viewportInner ?? DEFAULT_VIEWPORT_INNER,
    viewportOuter: input.viewportOuter ?? DEFAULT_VIEWPORT_OUTER,
    edgeMargin: input.edgeMargin ?? DEFAULT_EDGE_MARGIN,
  };
}

function validateDeadband(distanceMin: number, distanceMax: number): void {
  if (!Number.isFinite(distanceMin) || distanceMin < 0) {
    throw new RangeError(
      `computeTargetPlacement: distanceMin must be a non-negative finite number, got ${distanceMin}`
    );
  }
  if (!Number.isFinite(distanceMax) || distanceMax < distanceMin) {
    throw new RangeError(
      `computeTargetPlacement: distanceMax must be finite and ≥ distanceMin (${distanceMin}), got ${distanceMax}`
    );
  }
}

function validateViewport(
  viewportInner: number,
  viewportOuter: number,
  edgeMargin: number
): void {
  assertPositiveFinite('viewportInner', viewportInner);
  if (!Number.isFinite(viewportOuter) || viewportOuter < viewportInner) {
    throw new RangeError(
      `computeTargetPlacement: viewportOuter must be finite and ≥ viewportInner (${viewportInner}), got ${viewportOuter}`
    );
  }
  if (!Number.isFinite(edgeMargin) || edgeMargin <= 0 || edgeMargin > 1) {
    throw new RangeError(
      `computeTargetPlacement: edgeMargin must be in (0, 1], got ${edgeMargin}`
    );
  }
}

/** Boundary validation — the seam is consumed per frame by the presenter;
 * malformed configuration must fail loudly here instead of surfacing as NaN
 * transforms frames later. */
function validatePlacementInput(input: ResolvedPlacementInput): void {
  assertPositiveFinite('hudDistance', input.hudDistance);
  validateDeadband(input.distanceMin, input.distanceMax);
  validateViewport(input.viewportInner, input.viewportOuter, input.edgeMargin);
}

function placeCircle(
  base: TargetPlacementBase,
  hudDistance: number
): CirclePlacement {
  const circleX =
    THREE.MathUtils.clamp(base.ndc.x, -1, 1) * (base.frustumWidth / 2);
  const circleY =
    THREE.MathUtils.clamp(base.ndc.y, -1, 1) * (base.frustumHeight / 2);

  return {
    ...base,
    state: 'circle',
    circlePosition: new THREE.Vector3(circleX, circleY, -hudDistance),
    labelPosition: new THREE.Vector3(
      circleX,
      circleY - hudDistance * 0.08,
      -hudDistance
    ),
  };
}

function placeArrow(
  base: TargetPlacementBase,
  hudDistance: number,
  edgeMargin: number
): ArrowPlacement {
  let arrowNdcX = base.ndc.x;
  let arrowNdcY = base.ndc.y;
  if (base.isBehind) {
    arrowNdcX *= -1;
    arrowNdcY *= -1;
  }

  const physicalX = arrowNdcX * (base.frustumWidth / 2);
  const physicalY = arrowNdcY * (base.frustumHeight / 2);
  const angle = Math.atan2(physicalY, physicalX);

  const maxAbsX = (base.frustumWidth / 2) * edgeMargin;
  const maxAbsY = (base.frustumHeight / 2) * edgeMargin;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const tX = maxAbsX / Math.max(Math.abs(cosA), 0.0001);
  const tY = maxAbsY / Math.max(Math.abs(sinA), 0.0001);
  const t = Math.min(tX, tY);

  const arrowX = cosA * t;
  const arrowY = sinA * t;

  return {
    ...base,
    state: 'arrow',
    arrowPosition: new THREE.Vector3(arrowX, arrowY, -hudDistance),
    arrowRotationZ: angle - Math.PI / 2,
    labelPosition: new THREE.Vector3(
      arrowX - cosA * hudDistance * 0.1,
      arrowY - sinA * hudDistance * 0.1,
      -hudDistance
    ),
  };
}

/**
 * Compute the placement view-model for one target waypoint.
 *
 * Note: calls `camera.updateMatrixWorld()` so the projection uses the
 * camera's current pose (parity with the prototype) — the camera object is
 * otherwise not modified.
 */
export function computeTargetPlacement(
  input: TargetPlacementInput
): TargetPlacement {
  const resolved = resolvePlacementInput(input);
  validatePlacementInput(resolved);

  const {
    targetWorldPos,
    camera,
    hudDistance,
    distanceMin,
    distanceMax,
    previousState,
    isXrSession,
    viewportInner,
    viewportOuter,
    edgeMargin,
  } = resolved;

  camera.updateMatrixWorld();

  const { width: frustumWidth, height: frustumHeight } = getHudFrustumExtents(
    camera,
    hudDistance,
    isXrSession
  );

  const ndc = targetWorldPos.clone().project(camera);
  const localPos = targetWorldPos
    .clone()
    .applyMatrix4(camera.matrixWorldInverse);
  const isBehind = localPos.z > 0;
  const distance = camera.position.distanceTo(targetWorldPos);

  // Viewport hysteresis: while an arrow is showing, the target must come
  // clearly on-screen (inner limit) before it converts to a circle.
  const onScreenLimit =
    previousState === 'arrow' ? viewportInner : viewportOuter;
  const onScreen =
    !isBehind &&
    Math.abs(ndc.x) <= onScreenLimit &&
    Math.abs(ndc.y) <= onScreenLimit;

  const base: TargetPlacementBase = {
    onScreen,
    isBehind,
    distance,
    distanceLabel: formatDistanceLabel(distance),
    ndc,
    frustumWidth,
    frustumHeight,
  };

  // Distance gate FIRST — before the on/off-screen split (2026-07-18
  // revision after an AR field report): visibility is a pure distance state
  // machine, independent of the view direction. A fresh spawn (no
  // previousState) and any visible target need distanceMin; a deactivated
  // ('hidden') target reactivates only at distanceMax. The original
  // prototype parity exempted the off-screen arrow from this gate, which
  // let a glance away bypass the activation threshold (hidden → arrow →
  // ring at distanceMin without ever reaching distanceMax).
  const activationDistance =
    previousState === 'hidden' ? distanceMax : distanceMin;
  if (distance < activationDistance) {
    return { ...base, state: 'hidden' };
  }

  // Degenerate projection guard (deviation from the prototype, which emits
  // NaN transforms here): a target on the camera plane (w = 0, e.g. exactly
  // at the camera position) has no defined screen direction — hide it for
  // this frame instead of producing a NaN arrow.
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) {
    return { ...base, onScreen: false, state: 'hidden' };
  }

  if (onScreen) {
    return placeCircle(base, hudDistance);
  }

  return placeArrow(base, hudDistance, edgeMargin);
}
