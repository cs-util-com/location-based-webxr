/**
 * Component 8 budgets. Every number the AR viewing scene relies on lives here,
 * never inline, and every one is overridable through `createTourScene` options
 * so a test can set `modelLruCapacity: 1` and prove eviction without building
 * four models (plan §8).
 *
 * The proximity radii and the hysteresis fraction are NOT here — radii are
 * per-waypoint data in `tour.json` (contract D2) and the hysteresis fraction
 * belongs to component 4 (contract §4).
 *
 * @see plans/2026-07-31-ar-scene-plan.md §8
 */

/** Parsed GLTF templates kept warm after their waypoint drops to IDLE (A9). */
export const MODEL_LRU_CAPACITY = 3;

/** `parseAsync` runs on the main thread; more than this re-introduces jank (A8). */
export const MAX_CONCURRENT_PARSES = 2;

/** Breadcrumb orb meshes+anchors allocated once and recycled (A3). */
export const TRAIL_ORB_POOL_SIZE = 16;

/**
 * Orbs are near-field guidance only (A4). Deliberately smaller than the default
 * 25 m prefetch radius: a knight starts loading well before its orbs appear, and
 * the 2D map (component 7) covers the far view. The value most likely to need
 * field tuning — too small and orbs pop in underfoot, too large and the trail is
 * visual noise.
 */
export const TRAIL_WINDOW_RADIUS_M = 15;

/**
 * Orbs closer than this are drawn as one. Orbs are ~0.24 m across and glow
 * additively, so overlapping ones sum to a different colour; noisy recordings
 * (a device whose fix jumps back and forth) stack points on the same spot.
 * Display-only: breadcrumb data and progress still see every point.
 */
export const TRAIL_ORB_MIN_SEPARATION_M = 1;

/**
 * The wayfinding guide's own visual show/hide deadband (plan
 * 2026-09-17-breadcrumb-wayfinding, BW7) — deliberately permissive. The
 * orchestrator itself decides when a breadcrumb is "done" (arrival radius,
 * `BREADCRUMB_ARRIVAL_RADIUS_M`) and swaps to a fresh target id at that
 * moment; these two just need to avoid the framework presenter's OWN
 * distance gate fighting that decision. 0 means a freshly assigned target is
 * never hidden for being "too close"; 50 m is comfortably beyond any
 * realistic distance to the next breadcrumb.
 */
export const BREADCRUMB_GUIDE_DISTANCE_MIN_M = 0;
export const BREADCRUMB_GUIDE_DISTANCE_MAX_M = 50;

/**
 * How close counts as "arrived" at a breadcrumb (plan
 * 2026-09-17-breadcrumb-wayfinding, BW6) — a bit past the 3 m breadcrumb
 * sampling grain (`MIN_BREADCRUMB_DISTANCE_M`) so ordinary GPS jitter
 * reliably crosses it without the visitor needing to stand exactly on the
 * point. Tunable, same posture as every other threshold here — no stronger
 * justification available before real outdoor testing.
 */
export const BREADCRUMB_ARRIVAL_RADIUS_M = 5;

/**
 * When the nearest unvisited breadcrumb is farther than this (or none is
 * left), the recorded trail is no longer a useful guide — the wayfinding
 * target falls back to the next unvisited waypoint (tour order, D8) instead.
 * Deliberately well past `BREADCRUMB_ARRIVAL_RADIUS_M`: this is "trail lost",
 * not "arrived".
 */
export const BREADCRUMB_GIVE_UP_RADIUS_M = 50;

/**
 * Assumed visual footprint, in metres (A14, revised) — matches the sprite
 * template's own "knight-sized banner" default (`SPRITE_WIDTH_M`/`_HEIGHT_M`
 * in `gltf-loading.ts`). A GLTF model's real bounds aren't known until it's
 * parsed, so the transcript panel is placed off this assumed box rather than
 * a per-model bounding-box computation.
 */
const TRANSCRIPT_VISUAL_WIDTH_M = 1.08;
const TRANSCRIPT_VISUAL_HALF_WIDTH_M = TRANSCRIPT_VISUAL_WIDTH_M / 2;
/**
 * Also the transcript panel's own max-height cap: it may grow to fit long
 * text, but never taller than the visual it sits beside.
 */
export const TRANSCRIPT_VISUAL_HEIGHT_M = 1.8;

/** Transcript panel width, matched to the assumed visual's own width. */
export const TRANSCRIPT_PANEL_WIDTH_M = TRANSCRIPT_VISUAL_WIDTH_M;

/** Gap between the visual's assumed edge and a panel's edge. */
const TRANSCRIPT_PADDING_M = 0.15;

/**
 * Transport (play/pause) panel size, matched to component 1's demo panel
 * proportions.
 */
export const TRANSPORT_PANEL_WIDTH_M = TRANSCRIPT_VISUAL_WIDTH_M;
export const TRANSPORT_PANEL_HEIGHT_M = 0.4;

/**
 * How far the visual's own bottom edge floats above the ground (local Y),
 * sized to leave exactly enough room for the transport panel plus padding on
 * both sides. Both the sprite template (`gltf-loading.ts`) and the fallback
 * marker are raised by this amount so the transport panel always has a gap
 * to sit in beneath whichever visual actually renders.
 */
export const VISUAL_GROUND_CLEARANCE_M =
  TRANSPORT_PANEL_HEIGHT_M + 2 * TRANSCRIPT_PADDING_M;

/**
 * Transcript panel offset beside the visual, in metres. Local X so it moves
 * with the waypoint group's own yaw and always reads as "next to" the visual
 * rather than turning away from camera on its own. `textPanelWidthM` is the
 * panel's own configured width (`TextStyle.maxWidthMeters`), needed so the
 * padding is measured edge-to-edge rather than center-to-edge.
 *
 * `centered` is for the breadcrumb-only stop (no image, no model): with no
 * fallback marker taking up the visual's slot, the transcript moves into
 * that slot (local X = 0) instead of sitting beside it.
 */
export function transcriptOffset(
  textPanelWidthM: number,
  centered = false,
): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: centered
      ? 0
      : TRANSCRIPT_VISUAL_HALF_WIDTH_M +
        TRANSCRIPT_PADDING_M +
        textPanelWidthM / 2,
    // Vertically centred on the assumed visual height — the visual's own
    // centre sits `VISUAL_GROUND_CLEARANCE_M` above the ground now, so the
    // text stays centred on it by rising the same amount.
    y: VISUAL_GROUND_CLEARANCE_M + TRANSCRIPT_VISUAL_HEIGHT_M / 2,
  };
}

/**
 * Transport panel offset: centred directly beneath the visual (local X = 0,
 * not beside it like the transcript column) in the ground-clearance gap the
 * visual floats above, with equal padding above and below the panel.
 */
export function transportPanelOffset(): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: 0,
    y: VISUAL_GROUND_CLEARANCE_M / 2,
  };
}
