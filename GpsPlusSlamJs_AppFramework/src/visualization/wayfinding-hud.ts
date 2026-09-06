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

import {
  computeDiamondEntrance,
  type DiamondEntranceState,
} from './diamond-entrance.js';
import {
  createDiamondMarkerTexture,
  type DiamondMarkerTexture,
} from './diamond-marker-texture.js';

export type { WayfindingTarget } from './wayfinding-targets.js';

/**
 * Opt-in: the circle indicator is the design system's diamond BUILDING
 * ITSELF UP (outline drawn over 800 ms, dot popping at 600-850 ms) each
 * time a target appears or comes back through the distance gate. The
 * marker is drawn per target into a canvas texture
 * (`diamond-marker-texture.ts`) from the pure timeline in
 * `diamond-entrance.ts`. Meant alongside `arrowSprite`: with a procedural
 * arrow the scene mixes a Sprite circle and a Mesh arrow. Mutually
 * exclusive with `circleSprite`. Plan:
 * `GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md`.
 */
export interface CircleEntranceOptions {
  /** The outline and dot-stroke colour — the sheet's `--ink`. */
  ink: string;
  /** The dot's fill — the sheet's `--accent`. */
  accent: string;
  /** The halo colour; defaults to the SVG's black at 0.8. */
  halo?: string;
  /**
   * Redraw cap while animating, in redraws per second. Default 30: 27
   * redraws over the 850 ms entrance (the t = 0 frame, 25 capped ones and
   * the settling frame) instead of one per frame at 90 Hz.
   */
  redrawHz?: number;
  /**
   * Spawns that start in the SAME frame are offset by this many ms each
   * (0, 60, 120 …), so their redraws do not all land on one frame. Default 60.
   */
  staggerMs?: number;
  /**
   * Show the complete marker at once. Defaults to the OS setting
   * (`prefers-reduced-motion: reduce`), read ONCE at creation — the sheet
   * reacts live, the HUD from the next entrance on.
   */
  reducedMotion?: boolean;
}

/** Defaults for the optional {@link CircleEntranceOptions} fields. */
export const DEFAULT_CIRCLE_ENTRANCE = {
  redrawHz: 30,
  staggerMs: 60,
} as const;

/** What the last `update` spent on entrances — the on-device cost readout. */
export interface EntranceStats {
  /** Marker redraws (canvas draws + texture uploads) in the last update. */
  redraws: number;
  /**
   * Wall-clock milliseconds those redraws took (0 where `performance` is
   * absent). `performance.now()` is clamped to 100 µs in a page that is not
   * cross-origin isolated, and a desktop redraw costs ~0.04 ms, so this
   * reads 0.00 or 0.10 on a desktop — the number is meaningful on a headset
   * (0.3-1.0 ms estimated), which is what it exists for.
   */
  drawMs: number;
  /** Targets whose entrance was still animating after the last update. */
  animating: number;
  /**
   * The costliest entrance's ACCUMULATED draw milliseconds since it began —
   * the sum of ~27 redraws, so it clears the browser clock's 100 µs floor
   * where a single frame's `drawMs` does not (owner decision, 2026-09-06).
   * Reset when that target's entrance restarts; holds its last value once
   * settled.
   */
  entranceMs: number;
  /** The costliest single redraw of that entrance, in milliseconds. */
  peakDrawMs: number;
}

/** The all-zero readout: without the option, before the first update, after dispose. */
const NO_ENTRANCE_STATS: EntranceStats = Object.freeze({
  redraws: 0,
  drawMs: 0,
  animating: 0,
  entranceMs: 0,
  peakDrawMs: 0,
});

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
   * Tint of the PROCEDURAL cone and ring. Default: the design system's accent
   * (`--accent` in design.css, `#f2971f`); an app that vendors the sheet can
   * pass the live token so the WebGL indicators follow a re-tuned accent.
   * Inert in image mode: sprites are tinted white so the texture's own
   * colours show. Any `THREE.ColorRepresentation` (hex number, CSS string,
   * `THREE.Color`); the SHAPE is validated at construction because
   * `THREE.Color` reads an object, a boolean or `null` as black without a
   * word. A string's content is not: a malformed CSS colour reaches
   * `THREE.Color`, which warns on the console and keeps its default.
   */
  indicatorColor?: THREE.ColorRepresentation;
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
   * Opt-in build-up of the circle indicator; see {@link CircleEntranceOptions}.
   * Mutually exclusive with `circleSprite`. Absent (the default): the circle
   * is the procedural ring or `circleSprite`, exactly as before.
   */
  circleEntrance?: CircleEntranceOptions;
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
  /**
   * The design system's `--accent`. A literal because a library cannot read a
   * consumer's stylesheet; `tests/repo-config/design-accent-copies.test.js`
   * holds it to the token (owner taste round 2026-09-04, replacing the
   * prototype's red 0xff3b30).
   */
  indicatorColor: '#f2971f',
} as const;

export interface WayfindingHud {
  /**
   * Explicit per-frame tick for hosts that own their render loop — only
   * meaningful with `autoRegisterFrameUpdate: false` (see that option).
   * No-op after dispose().
   */
  update(dt: number): void;
  /**
   * What the last `update` spent on `circleEntrance` redraws. All zeros
   * without the option, before the first update, and after dispose.
   */
  entranceStats(): EntranceStats;
  /** Detach and release everything. Idempotent; also runs on session end. */
  dispose(): void;
}

/**
 * The procedural ring, in HUD-plane units before `indicatorScale`. The outer
 * radius is what the placement and the demo's pixel e2e were sized against
 * and stays; the width is a third of the prototype's 0.04 (owner taste round
 * 2026-09-04: "a thinner ring, a third as thick, in the accent").
 */
const RING_OUTER_RADIUS = 0.12;
const RING_WIDTH = 0.04 / 3;
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
 * `THREE.Color` accepts a hex number, a CSS colour string or a Color; anything
 * else it silently reads as black, which over dark ground is a HUD nobody
 * can see and no error anywhere.
 */
function validateIndicatorColor(value: unknown): void {
  const ok =
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'string' ||
    (typeof value === 'object' &&
      value !== null &&
      (value as Partial<THREE.Color>).isColor === true);
  if (!ok) {
    throw new TypeError(
      `createWayfindingHud: indicatorColor must be a hex number, a CSS colour string or a THREE.Color, got ${String(value)}`
    );
  }
}

function assertColourOption(name: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(
      `createWayfindingHud: circleEntrance.${name} must be a non-empty CSS colour string, got ${JSON.stringify(value)}`
    );
  }
}

/**
 * The entrance option is validated like every other option, and to the same
 * standard: a `redrawHz` of 0 would divide to an infinite interval (never
 * redraw) and a negative one would redraw every frame on the device the cap
 * exists to protect; an empty colour paints nothing without a word.
 */
function validateCircleEntrance(
  entrance: CircleEntranceOptions,
  circleSprite: WayfindingHudOptions['circleSprite']
): void {
  if (circleSprite !== undefined) {
    throw new TypeError(
      'createWayfindingHud: circleEntrance and circleSprite are mutually exclusive — the entrance draws its own circle texture'
    );
  }
  assertColourOption('ink', entrance.ink);
  assertColourOption('accent', entrance.accent);
  if (entrance.halo !== undefined) assertColourOption('halo', entrance.halo);
  assertPositiveFiniteOption(
    'circleEntrance.redrawHz',
    entrance.redrawHz ?? DEFAULT_CIRCLE_ENTRANCE.redrawHz
  );
  // The stagger is an OFFSET: 0 ("all spawns start together") is its
  // natural setting for a single target or a deterministic replay scene,
  // so unlike the cap it is non-negative rather than positive (PR #423).
  const staggerMs = entrance.staggerMs ?? DEFAULT_CIRCLE_ENTRANCE.staggerMs;
  if (
    typeof staggerMs !== 'number' ||
    !Number.isFinite(staggerMs) ||
    staggerMs < 0
  ) {
    throw new RangeError(
      `createWayfindingHud: circleEntrance.staggerMs must be a non-negative finite number, got ${staggerMs}`
    );
  }
  if (
    entrance.reducedMotion !== undefined &&
    typeof entrance.reducedMotion !== 'boolean'
  ) {
    throw new TypeError(
      `createWayfindingHud: circleEntrance.reducedMotion must be a boolean, got ${String(entrance.reducedMotion)}`
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
  if (options.circleEntrance !== undefined) {
    validateCircleEntrance(options.circleEntrance, options.circleSprite);
  }
  // `=== undefined`, not `??`: an explicit null must be rejected, not defaulted.
  validateIndicatorColor(
    options.indicatorColor === undefined
      ? DEFAULT_WAYFINDING_HUD.indicatorColor
      : options.indicatorColor
  );
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
    const texture = new THREE.TextureLoader().load(source);
    // An image file's pixels are sRGB. Untagged, three.js treats them as
    // linear and renders them lighter than authored — noticeable once the
    // sprite carries the design accent rather than a single flat colour.
    // A caller-passed Texture keeps whatever colour space the caller chose.
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, owned: true };
  }
  return { texture: source, owned: false };
}

/** The per-target entrance clock, present only with `circleEntrance`. */
interface EntranceState {
  marker: DiamondMarkerTexture;
  /** Milliseconds since the entrance began; negative while staggered. */
  elapsedMs: number;
  /** `elapsedMs` at the last redraw — the cap compares against it. */
  lastRedrawMs: number;
  /** True while the timeline still changes; false once settled. */
  animating: boolean;
  /** Started in this update: the t = 0 frame is drawn, not advanced. */
  fresh: boolean;
  /**
   * Whether this target's entrance has EVER run. A target whose first
   * placement is an edge arrow (in range, off-screen) reaches its first
   * circle with `previous === 'arrow'`; without this flag that first showing
   * would never start the entrance, and nothing else draws the marker
   * (milestone review, 2026-09-06).
   */
  started: boolean;
  /** Draw milliseconds accumulated since this entrance began. */
  drawMsTotal: number;
  /** The costliest single redraw since this entrance began. */
  peakDrawMs: number;
}

interface TargetState {
  /** null = freshly created, no frame yet — the placement seam applies its
   * SPAWN rule (visible at distanceMin) instead of the reactivation rule. */
  currentState: TargetPlacementState | null;
  arrow: THREE.Mesh | THREE.Sprite;
  circle: THREE.Mesh | THREE.Sprite;
  label: TextSprite;
  smoothedCirclePos: THREE.Vector3;
  entrance: EntranceState | null;
}

/** The OS setting, read once; `false` where `matchMedia` is absent (jsdom, workers). */
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The validated `circleEntrance` option with its defaults applied. */
interface ResolvedEntranceOptions {
  ink: string;
  accent: string;
  halo?: string;
  /** `1000 / redrawHz`: the least timeline time between two redraws. */
  redrawIntervalMs: number;
  staggerMs: number;
  reducedMotion: boolean;
}

/**
 * Resolve the entrance option once at creation: colours, the redraw
 * interval, the stagger, and the reduced-motion read (the OS setting unless
 * the option forces it). `null` without the option.
 */
function resolveEntranceOptions(
  entrance: CircleEntranceOptions | undefined
): ResolvedEntranceOptions | null {
  if (!entrance) return null;
  return {
    ink: entrance.ink,
    accent: entrance.accent,
    ...(entrance.halo !== undefined ? { halo: entrance.halo } : {}),
    redrawIntervalMs:
      1000 / (entrance.redrawHz ?? DEFAULT_CIRCLE_ENTRANCE.redrawHz),
    staggerMs: entrance.staggerMs ?? DEFAULT_CIRCLE_ENTRANCE.staggerMs,
    reducedMotion: entrance.reducedMotion ?? prefersReducedMotion(),
  };
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
  const indicatorColor =
    options.indicatorColor ?? DEFAULT_WAYFINDING_HUD.indicatorColor;

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
      color: indicatorColor,
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

  // The entrance option, resolved once (colours, cap, stagger, the
  // reduced-motion read); null without the option.
  const entranceOptions = resolveEntranceOptions(options.circleEntrance);
  /** Spawns started in the current update — the stagger multiplier. */
  let spawnsThisUpdate = 0;
  let stats: EntranceStats = { ...NO_ENTRANCE_STATS };

  function makeEntrance(): EntranceState | null {
    if (!entranceOptions) return null;
    const marker = createDiamondMarkerTexture({
      ink: entranceOptions.ink,
      accent: entranceOptions.accent,
      ...(entranceOptions.halo !== undefined
        ? { halo: entranceOptions.halo }
        : {}),
    });
    return {
      marker,
      elapsedMs: 0,
      lastRedrawMs: Number.NEGATIVE_INFINITY,
      animating: false,
      fresh: false,
      started: false,
      drawMsTotal: 0,
      peakDrawMs: 0,
    };
  }

  function makeCircle(
    entrance: EntranceState | null
  ): THREE.Mesh | THREE.Sprite {
    if (entrance) return makeIndicatorSprite(entrance.marker.texture);
    if (circleTexture) return makeIndicatorSprite(circleTexture.texture);
    circleGeometry ??= new THREE.RingGeometry(
      (RING_OUTER_RADIUS - RING_WIDTH) * indicatorScale,
      RING_OUTER_RADIUS * indicatorScale,
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
    const entrance = makeEntrance();
    const circle = makeCircle(entrance);
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
      entrance,
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
    // The marker texture is per target (the sprite material above only
    // releases itself); the shared procedural resources stay.
    state.entrance?.marker.dispose();
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

    // DEC-E3: the entrance starts on APPEARANCE (no previous state) and on
    // a return through the distance gate ('hidden' → circle) — never on a
    // head turn ('arrow' → circle, the viewport hysteresis), which would
    // rebuild the marker every time the wearer looks away and back.
    // The FIRST circle a target ever shows is an appearance too, whatever
    // preceded it: a target spawned in range but off-screen arrives here with
    // `previous === 'arrow'` and would otherwise never get its marker drawn.
    if (
      state.entrance &&
      (previous === null || previous === 'hidden' || !state.entrance.started)
    ) {
      startEntrance(state.entrance);
    }

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

  /** Begin (or restart) a target's entrance: the t = 0 frame is drawn now. */
  function startEntrance(entrance: EntranceState): void {
    const stagger = (entranceOptions?.staggerMs ?? 0) * spawnsThisUpdate;
    spawnsThisUpdate += 1;
    entrance.elapsedMs = -stagger;
    entrance.lastRedrawMs = entrance.elapsedMs;
    entrance.animating = true;
    entrance.fresh = true;
    entrance.started = true;
    entrance.drawMsTotal = 0;
    entrance.peakDrawMs = 0;
    redraw(entrance, entranceState(entrance));
  }

  function entranceState(entrance: EntranceState): DiamondEntranceState {
    // One decision, taken by the seam: reduced motion is its option, not a
    // second branch here (milestone review, 2026-09-06).
    return computeDiamondEntrance(entrance.elapsedMs, {
      reducedMotion: entranceOptions?.reducedMotion === true,
    });
  }

  function redraw(entrance: EntranceState, state: DiamondEntranceState): void {
    if (entrance.marker.apply(state)) {
      const drawMs = entrance.marker.lastDrawMs;
      stats.redraws += 1;
      stats.drawMs += drawMs;
      entrance.drawMsTotal += drawMs;
      if (drawMs > entrance.peakDrawMs) entrance.peakDrawMs = drawMs;
    }
    entrance.lastRedrawMs = entrance.elapsedMs;
    if (state.settled) entrance.animating = false;
  }

  /**
   * The per-frame clock of every animating entrance. `dt` is SECONDS
   * (`ar/frame-loop.ts`), the timeline milliseconds. Redraws are capped:
   * one per `redrawIntervalMs` of elapsed time, plus the settling frame; a
   * fresh entrance drew its t = 0 frame in this update and is not advanced.
   */
  function advanceEntrances(dt: number): void {
    if (!entranceOptions) return;
    // A non-finite dt (a host's broken clock) must not become a per-frame
    // throw: the pure seam rejects a non-finite time, so the ADVANCE is
    // skipped and the entrance waits for a real frame — while the readout
    // still reports it as animating, so a broken clock never reads as a
    // quiet one (PR #423 review). A negative dt (a clock stepping back)
    // must not rewind the timeline either: an entrance that kept being
    // rewound would animate forever (PR #422 CodeRabbit review); it counts
    // as a frame of zero length.
    const dtMs = Number.isFinite(dt) ? Math.max(0, dt) * 1000 : null;
    for (const state of states.values()) {
      const entrance = state.entrance;
      if (!entrance) continue;
      // PAUSED while the circle is not shown: a frame drawn then is never
      // presented — the marker comes back either as the same sprite (arrow →
      // circle, no restart) or through the distance gate, which restarts
      // from t = 0 (PR #424 review). The entrance still counts as animating.
      if (entrance.animating && dtMs !== null && state.circle.visible) {
        advanceOne(entrance, dtMs);
      }
      if (entrance.animating) stats.animating += 1;
      recordCostliest(entrance);
    }
  }

  /** One animating entrance's tick: the fresh frame is drawn, not advanced. */
  function advanceOne(entrance: EntranceState, dtMs: number): void {
    if (entrance.fresh) {
      entrance.fresh = false;
      return;
    }
    const tolerance = 1e-6; // 3 × (1/90 s) is 33.333… ms against a 33.333… ms interval
    entrance.elapsedMs += dtMs;
    const next = entranceState(entrance);
    const due =
      entrance.elapsedMs - entrance.lastRedrawMs >=
      (entranceOptions?.redrawIntervalMs ?? Number.POSITIVE_INFINITY) -
        tolerance;
    if (due || next.settled) redraw(entrance, next);
  }

  /**
   * The costliest entrance's totals, animating or settled: what the owner
   * reads on the headset after walking one target back in.
   */
  function recordCostliest(entrance: EntranceState): void {
    if (!entrance.started || entrance.drawMsTotal <= stats.entranceMs) return;
    stats.entranceMs = entrance.drawMsTotal;
    stats.peakDrawMs = entrance.peakDrawMs;
  }

  function update(dt: number): void {
    spawnsThisUpdate = 0;
    stats = { ...NO_ENTRANCE_STATS };
    const resolved = targets.resolve(getTargets());
    syncTargetStates(resolved);
    for (const target of resolved) {
      updateTarget(target, states.get(target.key) as TargetState, dt);
    }
    advanceEntrances(dt);
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
    entranceStats(): EntranceStats {
      return { ...stats };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stats = { ...NO_ENTRANCE_STATS };
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
