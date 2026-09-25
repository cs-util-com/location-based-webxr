/**
 * The `SceneAdapter` port — the single seam between orchestration and rendering
 * (plan A20).
 *
 * Everything in `runtime/` talks to the scene through this interface and never
 * imports THREE at runtime, which is what lets the replay e2e drive the real
 * store, the real proximity driver and the real orchestrator against a fake
 * adapter — in Node, with no WebGL. `view/three-scene-adapter.ts` is the one
 * real implementation.
 *
 * Handles are deliberately opaque. A port that handed back `THREE.Object3D`
 * would leak the rendering layer straight back into the orchestrator and buy
 * nothing.
 *
 * `Vector3` is imported **type-only** (the same trick component 4's pure core
 * uses): positions are produced by the adapter and passed through, never
 * constructed here, so `runtime/` carries zero runtime dependency on THREE.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §4.3
 */

import type { Vector3 } from "three";

import type { TourCoord } from "../../../store/types.js";

/** A waypoint's anchored root in the scene graph. */
export interface WaypointHandle {
  readonly waypointId: string;
}

/** A parsed, GPU-resident model/sprite template — shared by clones (A9). */
export interface TemplateHandle {
  readonly templateId: string;
}

/** One waypoint's instance of a template (a clone), attached under its root. */
export interface VisualHandle {
  readonly visualId: string;
}

/** What the visitor tapped, classified by the adapter's ray source. */
export interface TapHit {
  readonly waypointId: string;
  /**
   * `"visual"` = the knight itself; `"transcript"` = the text panel;
   * `"transport"` = the always-visible play/pause + seek panel (component 1's
   * transport panel) — the runtime maps `uv` through component 1's
   * `hitToAction` to tell a button tap (toggle) from a track tap (seek)
   * instead of treating every hit on it as a toggle.
   */
  readonly role: "visual" | "transcript" | "transport";
  /** Panel-local hit position in [0,1] (the mesh's `PlaneGeometry` UV); set
   *  for a `"transport"` hit (resolves toggle vs seek) and a `"transcript"`
   *  hit (resolves prev vs next vs a no-op tap on the text body). */
  readonly uv?: { readonly u: number; readonly v: number };
}

/**
 * A breadcrumb index + its coordinate to guide the visitor toward. Carries
 * the index (not just the coordinate) so the concrete adapter can give the
 * framework's wayfinding presenter a fresh per-target id on every swap —
 * reusing the same id across two different breadcrumbs would carry over
 * that presenter's own arrival/hysteresis state from the wrong target.
 */
interface BreadcrumbTarget {
  readonly kind: "breadcrumb";
  readonly index: number;
  readonly coord: TourCoord;
}

/**
 * A waypoint id + its coordinate to guide the visitor toward — the fallback
 * used when no breadcrumb is close enough to trust (config
 * `BREADCRUMB_GIVE_UP_RADIUS_M`). Keyed by waypoint id rather than a
 * breadcrumb index for the same fresh-id reason as `BreadcrumbTarget`.
 */
interface WaypointGuideTarget {
  readonly kind: "waypoint";
  readonly id: string;
  readonly coord: TourCoord;
}

/** The single "walk here next" guide target, or `null` to show nothing. */
export type WayfindingTarget = BreadcrumbTarget | WaypointGuideTarget;

export interface SceneAdapter {
  // ── Anchoring (A1) ────────────────────────────────────────────────────────
  /** Create the waypoint's anchored root. The adapter owns `createGpsAnchor`. */
  createWaypointRoot(id: string, coord: TourCoord): WaypointHandle;
  destroyWaypointRoot(handle: WaypointHandle): void;
  /**
   * Has the anchor left its bootstrap phase? An anchor still accumulating GPS
   * samples has a provisional position, and activating a knight on it would put
   * him tens of metres away (A19).
   */
  isAnchored(handle: WaypointHandle): boolean;
  getWorldPosition(handle: WaypointHandle): Vector3 | null;

  /**
   * Convert breadcrumb coordinates to world space **without** anchoring them —
   * the trail window has to know where points are before deciding which few
   * deserve an orb. `null` per entry when no alignment/zero-reference exists yet.
   */
  toWorldPositions(coords: readonly TourCoord[]): readonly (Vector3 | null)[];

  /** The visitor's live world-space pose, read from the framework (contract D11). */
  getUserPosition(): Vector3 | null;

  /** Place the ≤ pool-size orbs (A3). Slots holding `null` are hidden. */
  setOrbCoords(coords: readonly (TourCoord | null)[]): void;

  /** The single "walk here next" guide target (plan 2026-09-17). */
  setWayfindingTarget(target: WayfindingTarget | null): void;
  /**
   * World positions of every currently-ACTIVE waypoint (plan
   * 2026-09-17-breadcrumb-wayfinding). Lets the concrete adapter suppress
   * the wayfinding indicator only while one of them is actually in the
   * camera's current view, not for the whole time it stays ACTIVE — after
   * the visitor walks past an open waypoint and turns away, the guide
   * should reappear even though that zone hasn't exited yet.
   */
  setActiveWaypointPositions(positions: readonly Vector3[]): void;

  // ── Visuals: template (shared, LRU'd) vs instance (per waypoint) ───────────
  /** Fetch-free: parse the asset at `url` into a shared template. Async + heavy. */
  buildTemplate(kind: "model" | "sprite", url: string): Promise<TemplateHandle>;
  /** Free the template's GPU resources. Called on LRU eviction only (A9). */
  disposeTemplate(template: TemplateHandle): void;
  /**
   * Clone the template under the waypoint's root, INVISIBLE (§2.5.3).
   * `hasAudio` (default `true`) gates the always-visible transport panel —
   * pass `false` for a waypoint with no sound asset so no play/pause control
   * appears under a story that cannot play anything.
   */
  instantiate(
    handle: WaypointHandle,
    template: TemplateHandle,
    hasAudio?: boolean,
  ): VisualHandle;
  /**
   * Procedural stand-in when an asset is missing or corrupt (§7.2 soft-fail).
   * `showMarker` (default `true`) draws the cone; pass `false` for a
   * breadcrumb-only stop whose transcript already fills the visual's slot —
   * the transport panel (when `hasAudio`) is still built either way.
   */
  buildFallbackVisual(
    handle: WaypointHandle,
    hasAudio?: boolean,
    showMarker?: boolean,
  ): VisualHandle;
  /** Detach + drop this clone. Never deep-disposes shared resources (A10). */
  releaseVisual(visual: VisualHandle): void;
  setVisible(visual: VisualHandle, visible: boolean): void;

  // ── Transcript (component 2, A14/A15) ─────────────────────────────────────
  /**
   * `centered` places the panel in the visual's own slot (local X = 0)
   * instead of beside it — used for a breadcrumb-only stop (no image, no
   * model) where no fallback marker occupies that slot.
   */
  showTranscript(
    handle: WaypointHandle,
    text: string,
    centered?: boolean,
  ): void;
  hideTranscript(handle: WaypointHandle): void;
  disposeTranscript(handle: WaypointHandle): void;
  /** Page the shown transcript after a tap on its controls (`uv` decides prev/next/no-op). */
  pageTranscript(
    handle: WaypointHandle,
    uv?: { readonly u: number; readonly v: number },
  ): void;

  // ── Audio (component 1's player, A16/A17) ─────────────────────────────────
  playAudio(handle: WaypointHandle, url: string): void;
  pauseAudio(): void;
  resumeAudio(): void;
  stopAudio(): void;
  /** Scrub the given waypoint's own audio to `fraction` (in [0,1]) of its
   *  known duration. A no-op if that waypoint has no audio element yet. */
  seekAudio(handle: WaypointHandle, fraction: number): void;
  /** `true` when the injected `AudioListener`'s context is running (A16). */
  isAudioReady(): boolean;

  // ── Interaction (A11/A12) ─────────────────────────────────────────────────
  /** Replace the raycast target set. Only ACTIVE visuals belong in it. */
  setPickTargets(handles: readonly WaypointHandle[]): void;
  onTap(listener: (hit: TapHit) => void): () => void;
  onAudioEnded(listener: () => void): () => void;

  /** Per-frame view work the orchestrator does not model (billboard yaw, …). */
  update(dtSeconds: number): void;
  dispose(): void;
}
