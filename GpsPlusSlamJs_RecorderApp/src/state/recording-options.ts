/**
 * Recording Options - User-configurable settings for data capture.
 *
 * Allows users to disable/configure high-frequency data streams
 * (depth sampling, image capture) to improve performance on lower-end devices.
 *
 * Options persist in localStorage across sessions.
 *
 * The RECORDER owns this catalog (moved out of the framework's `state/` layer
 * on 2026-07-11, G-1 move — see
 * `GpsPlusSlamJs_Docs/docs/2026-07-11-1445-recording-options-altitude-move-plan.md`).
 *
 * **Ownership rule: a group whose TYPE the framework owns is validated by the
 * framework too.** The bounds of `motionFilter.maxAngularVelocity` or
 * `qualityFilter.blurRelativeThreshold` are statements about what those gates
 * do, not about this app, so the constraint tables and validators live with the
 * gates and are consumed here. This catalog only declares the bounds of the
 * groups it actually owns. Framework-owned groups consumed here:
 * - `arCrashIsolation` — type/defaults/validator from
 *   `gps-plus-slam-app-framework/ar/ar-crash-isolation` (the framework reads
 *   the flags in `webxr-session.ts`).
 * - `images.motionFilter` — from `ar/capture-motion-gate` (the gate that
 *   consumes the thresholds); its constraints are re-exported below.
 * - `images.qualityFilter` — from `ar/image-quality` (likewise).
 * - `OccluderDebugStyle` (+ its values array) from
 *   `gps-plus-slam-app-framework/visualization/occlusion-mesh` (the consumer
 *   of the style); re-exported below for recorder callers.
 *
 * The per-group validators below are spec tables over the framework's
 * `validateOptionFields`, which makes them exhaustive over their group type:
 * adding a field to an options interface is a compile error until its
 * validation is declared.
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { validateOptionFields } from 'gps-plus-slam-app-framework/utils/validate-option-fields';
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
} from 'gps-plus-slam-app-framework/ar/depth-sampler';
import {
  DEFAULT_MOTION_FILTER,
  validateMotionFilterConfig,
  type MotionFilterConfig,
} from 'gps-plus-slam-app-framework/ar/capture-motion-gate';
import {
  DEFAULT_QUALITY_FILTER,
  validateQualityFilterConfig,
  type QualityFilterConfig,
} from 'gps-plus-slam-app-framework/ar/image-quality';
import {
  DEFAULT_AR_CRASH_ISOLATION,
  validateArCrashIsolationOptions,
  type ArCrashIsolationOptions,
} from 'gps-plus-slam-app-framework/ar/ar-crash-isolation';
import {
  OCCLUDER_DEBUG_STYLES,
  type OccluderDebugStyle,
} from 'gps-plus-slam-app-framework/visualization/occlusion-mesh';
import {
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from 'gps-plus-slam-app-framework/ar/occupancy-grid';

// Re-exported so recorder import sites keep sourcing the style union from the
// catalog (the framework owns the definition — see the header comment).
// `ArCrashIsolationOptions` is deliberately NOT re-exported: no recorder site
// imports it standalone; import it from
// `gps-plus-slam-app-framework/ar/ar-crash-isolation` if that changes.
export type { OccluderDebugStyle };

// Same rationale for the two framework-owned gate constraint tables: this
// catalog is the recorder's ONE options surface, so `ui/settings-modal.ts`
// reads every slider range from here rather than from a mix of local tables and
// framework deep paths. These are pass-throughs, not restatements — the bounds
// still have exactly one definition, in the gate that gives them meaning.
export { MOTION_FILTER_CONSTRAINTS } from 'gps-plus-slam-app-framework/ar/capture-motion-gate';
export { QUALITY_FILTER_CONSTRAINTS } from 'gps-plus-slam-app-framework/ar/image-quality';

const log = createLogger('RecordingOptions');

// --- Types ---

/**
 * Input type for validateRecordingOptions allowing partial nested objects.
 * This allows passing incomplete objects that will be merged with defaults.
 */
export interface RecordingOptionsInput {
  depth?: Partial<DepthCaptureOptions>;
  images?: Partial<ImageCaptureOptions>;
  arCrashIsolation?: Partial<ArCrashIsolationOptions>;
  occupancy?: Partial<OccupancyOptions>;
  frameTileDisplay?: Partial<FrameTileDisplayOptions>;
  visualization?: Partial<VisualizationOptions>;
  qr?: Partial<QrCaptureOptions>;
  compassDebug?: Partial<CompassDebugOptions>;
  loopClosureDebug?: Partial<LoopClosureDebugOptions>;
}

/**
 * Toggles for the library's Phase-4 compass alignment features (closed/internal
 * `AlignmentConfig` flags exposed via narrow boolean actions). They change how
 * the LIVE alignment is computed, so they sit with the other capture groups.
 * **Stage 0 (`coldStartOverride`) defaults ON** (a field-validated production
 * feature); Stage C + the WebXR-consistency gate stay experimental (default
 * OFF) until the §6a field-data matrix is in.
 *
 * On-device caveat: the resulting `gpsData` opt-in actions persist into the
 * recording, so the DEFAULT `replayAll` re-enables them. This does NOT modify the
 * raw recorded stream (`rawAbsoluteOrientation`, GPS, odometry) — only the
 * *derived* alignment — so an investigation that re-solves from the raw
 * observations under a chosen `AlignmentConfig` (`recomputeAlignment`) is
 * unaffected by the capture-time flag state. Turning the flags off during capture
 * only matters if you want the LIVE app to behave as the GPS-only baseline; it is
 * not required for clean §6a analysis data. See
 * `GpsPlusSlamJs_Docs/docs/2026-06-26-0701-stage0-field-collection-and-enablement.md`
 * (2026-07-01 update).
 */
export interface CompassDebugOptions {
  /** Stage 0 — cold-start compass yaw override (`setColdStartOverrideEnabled`). Default ON. */
  coldStartOverride: boolean;
  /** Stage C — trust-gated compass rotation prior (`setCompassRotationPriorEnabled`). */
  rotationPrior: boolean;
  /** GPS-free compass↔WebXR consistency gate (`setCompassWebXRConsistencyEnabled`). */
  webXRConsistency: boolean;
  /**
   * 2026-07-19 field-test combo (`setCompassExperimentEnabled`): rotation
   * prior + trust tolerance 15° + C′ compass-guided pair selection. The combo
   * lives in the library; this is a single boolean. Default OFF. See the
   * private repo's compass-experiment recorder enablement plan.
   */
  experiment: boolean;
  /**
   * Alternative robust-solver comparison arm (`setRobustSolverComparisonEnabled`) for on-device
   * A/B against the experiment — NOT a compass mechanism. Default OFF.
   */
  robustSolverComparison: boolean;
  /**
   * Steady-state compass vote weight ∈ [0,1] (`setCompassVoteWeight`) — how
   * strongly a trusted compass pulls the rotation once GPS yaw is observable.
   * Only consulted while the experiment / rotation prior is active. Default
   * 0.3 (the library default); the 2026-07-19 census weight curve measured
   * 0.1 as the whole-session optimum — the slider exists to field-test both.
   */
  voteWeight: number;
}

/**
 * Live loop-closure capture toggles (experimental, default OFF).
 *
 * When `detectorEnabled` is on, the recorder feeds every AR frame's raw WebXR
 * pose into the library's `createLoopClosureHandler`, so an AR relocalization
 * jump (>1 m between consecutive frames) dispatches `arLoopClosureDetected`
 * into the session store — and therefore into the recording. This is the
 * missing producer that has kept the whole corpus loop-closure-free (the
 * pair-refresh T5 verdict is blocked on such recordings). It also changes the
 * LIVE alignment (each closure Bézier-deforms the stored trajectory), which is
 * why it stays an operator opt-in. See
 * GpsPlusSlamJs_Docs/docs/2026-07-06-2228-recorder-loop-closure-detector-wiring-plan.md.
 */
export interface LoopClosureDebugOptions {
  /** Wire the live loop-closure handler into the AR frame loop. Default OFF. */
  detectorEnabled: boolean;
}

/**
 * Configuration for depth sampling during recording.
 */
export interface DepthCaptureOptions {
  /** Whether to capture depth samples. Default: true */
  enabled: boolean;
  /** Interval between samples in milliseconds. Default: 200 (2026-07-16 on-device framerate/mesh trade-off). */
  intervalMs: number;
  /**
   * Grid size (N×N points per sample). Default: 24 (2026-07-16 on-device
   * framerate/mesh trade-off) — dense enough to populate the AR-space
   * occupancy grid (2026-06-11 port plan §1) without hurting the framerate.
   */
  gridSize: number;
  /**
   * Whether to enrich each depth point with the camera color at its view
   * coordinates (RGB voxel coloring, occupancy-grid port plan Iter 8).
   * Costs one small GPU blit+readback per sample (5 Hz at the default cadence); when off, the
   * occupancy cubes keep the height-based coloring. Default: true.
   */
  rgb: boolean;
}

/**
 * Configuration for image capture during recording.
 */
export interface ImageCaptureOptions {
  /** Whether to capture images. Default: true */
  enabled: boolean;
  /** Interval between captures in milliseconds. Default: 2000 */
  intervalMs: number;
  /** JPEG quality (0.0 - 1.0). Default: 0.7 */
  quality: number;
  /** Resolution divisor: 1 = full native resolution, 2 = half, 4 = quarter. Default: 1 */
  resolutionDivisor: number;
  /**
   * Motion gate — skip motion-blurred frames by deferring a due capture until
   * device motion settles. Mirrors `ImageCaptureConfig.motionFilter` (the type
   * the capture manager consumes); the recorder destructures `images` and flows
   * the rest, including this group, through the capture seam. Default: enabled.
   * See `ar/capture-motion-gate.ts` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-23-2105-blurry-frame-motion-gating-plan.md`.
   */
  motionFilter: MotionFilterConfig;
  /**
   * Image-quality gate — drop a blurry/black frame (judged off-thread) and retry
   * the next acceptable frame. Mirrors `ImageCaptureConfig.qualityFilter`; flows
   * through the same capture seam as `motionFilter`. **Default: disabled**
   * pending field tuning of the relative blur threshold (a mis-tuned gate
   * silently dropping good frames is worse than the motion gate's default-on).
   * See `ar/image-quality.ts` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-24-1057-image-quality-gate-plan.md`.
   */
  qualityFilter: QualityFilterConfig;
}

/**
 * Configuration for the derived AR-space occupancy grid (the voxelization of
 * the depth samples, port plan 2026-06-11). These settings do NOT change what
 * is recorded — they govern the grid derived from the recorded depth points,
 * so they also apply when replaying an existing recording, letting the same
 * session be re-quantized at a different resolution.
 */
/**
 * Mesher strategy for the **persistent occluder** mesh, exposed as a recorder
 * setting (2026-06-30 occluder-tuning, F2/F2b) so the two surface-hugging
 * approaches can be A/B-tested on-device against the blocky baseline:
 * - `'greedy'` — blocky greedy cubes (the existing default; fewest triangles).
 * - `'corner-fit'` — cubes with corners pulled to the measured centroids
 *   (surface-hugging **and** watertight).
 * - `'smooth'` — surface nets: smoothest, hugs the measured surface, but an open
 *   sheet over thin features.
 *
 * Maps directly onto `meshOccupiedCells` / `OcclusionMesh` `MeshMode` (a subset).
 * `'per-face'` is intentionally not offered (same shape as `'greedy'`, more
 * triangles — no on-device value).
 */
const OCCLUDER_MESH_MODES = ['greedy', 'corner-fit', 'smooth'] as const;
export type OccluderMeshMode = (typeof OCCLUDER_MESH_MODES)[number];

export interface OccupancyOptions {
  /**
   * Voxel edge length in metres. Drives the occupancy-grid quantization, the
   * debug cubes, and the COLMAP `points3D` density. Default `DEFAULT_OCCUPANCY_CELL_SIZE_M`
   * (0.16 = 16 cm; framework FAST-reconstruction default, shared with the
   * PhysicsDemo). Smaller = finer detail but cell count scales as 1/cellSize³, so the
   * range is deliberately clamped (see `OCCUPANCY_CONSTRAINTS`). Read once when
   * the grid is constructed (Enter-AR / replay load), so a change takes effect
   * on the next session rather than mid-session.
   */
  cellSizeM: number;
  /**
   * Minimum observation count for a voxel to be trusted as occupied (the
   * grid's `getOccupiedCells(minObservations)` floor, promoted to a user
   * setting). A cell is marked occupied the instant one noisy depth point
   * lands in it; raising this filters single-frame depth noise — in
   * particular the **behind-surface** phantoms (e.g. below the floor) that
   * free-space carving can never clear because no ray passes through occluded
   * space. Default `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS` (2; framework noise floor,
   * shared with the PhysicsDemo). 1 = unfiltered/legacy. Higher = less noise but
   * briefly-glimpsed real surfaces may be dropped, so it is exposed for
   * on-device tuning. Read once when the visualizer is constructed (Enter-AR
   * / replay load).
   *
   * Since 2026-07-16 this floor ALSO drives the grid's confidence-guarded
   * carving (`OccupancyGrid.carveConfidenceThreshold`, live + replay): a voxel
   * solid enough to be rendered can no longer be erased by a single deeper
   * depth reading (synthetic-scene investigation — eliminates silhouette-edge
   * churn and noisy occluded-background destruction). One knob, one meaning:
   * "how many observations until the app trusts a voxel". See
   * `GpsPlusSlamJs_Docs/docs/2026-06-22-2146-occupancy-grid-behind-surface-noise-plan.md`.
   */
  minConfidence: number;
  /**
   * Render a **persistent depth-only occlusion mesh** of the occupancy grid:
   * the grid's occupied cells are meshed (`meshOccupiedCells`) and drawn
   * invisible-but-depth-writing under `arWorldGroup`, so real geometry the
   * camera saw earlier hides virtual objects placed behind it — including
   * out-of-view surfaces a live depth occluder cannot remember. Default
   * **true** (since 2026-07-01): the Web-Worker mesh offload removed the
   * per-refresh render stall that was the reason to keep it opt-in, so the
   * remembered occluder ships on by the default `'smooth'` mesher. Read once when
   * the mesh is wired (Enter-AR / replay load), like the other occupancy knobs.
   * See `GpsPlusSlamJs_Docs/docs/2026-06-13-0004-occupancy-mesh-options-plan.md` and
   * `GpsPlusSlamJs_Docs/docs/2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`.
   *
   * **Migration:** this field replaces the former `occlusionMeshEnabled`
   * boolean — `validateOccupancyOptions` maps a persisted
   * `occlusionMeshEnabled === true` onto `persistentOcclusion` (see that
   * function and `2026-06-29-1414-occupancy-mesh-followups.md`).
   */
  persistentOcclusion: boolean;
  /**
   * Enable the **live CPU-depth occluder** — a per-frame depth occluder that
   * hides virtual content behind the real surface the camera sees *right now*,
   * sharp and registration-free (no out-of-view memory). It composes with
   * {@link persistentOcclusion}: both can be on (the live occluder wins where
   * this frame has depth, the persistent mesh fills out-of-view / depth holes —
   * `2026-06-14-0009-webxr-depth-occlusion-plan.md` §5). Requires the
   * `requestDepthOcclusion` session feature so `cpu-optimized` depth is
   * negotiated even without depth recording. **Live-AR only** — replay has no
   * live depth stream, so this flag is a no-op there (persistent still applies).
   * Default **false**: the live occluder's on-device occlusion quality is still
   * device-gated/unverified. Read once when the AR session is wired (Enter-AR).
   */
  liveOcclusion: boolean;
  /**
   * Which **visible debug skin(s)** render the persistent occluder mesh (see
   * {@link OccluderDebugStyle}) so its shape/structure can be judged on-device.
   * All styles are additive overlays — the invisible depth-only mesh keeps
   * writing depth unchanged, so occlusion is identical in every style. Only has
   * a visible effect when {@link persistentOcclusion} is on (it is that
   * occluder's mesh); any other value is a harmless no-op. Default **`'off'`**.
   * Read once when the mesh is wired (Enter-AR / replay load), like the other
   * occupancy knobs. See
   * `GpsPlusSlamJs_Docs/docs/2026-07-02-0611-occluder-debug-viz-styles-plan.md` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-29-2130-occlusion-debug-viz-and-live-occluder-user-feedback.md`.
   *
   * **Migration:** this field replaces the former `occluderDebugViz` boolean —
   * `validateOccupancyOptions` maps a persisted `occluderDebugViz: true` onto
   * `'matcap'` (the skin the boolean used to enable) when this field is absent,
   * mirroring the `occlusionMeshEnabled` → {@link persistentOcclusion}
   * migration.
   */
  occluderDebugStyle: OccluderDebugStyle;
  /**
   * Which mesher builds the **persistent occluder** mesh (see
   * {@link OccluderMeshMode}). Default `'smooth'` (since 2026-07-01) — Naive
   * Surface Nets, the smoothest and lightest mesh. Switch to `'greedy'` (blocky
   * cubes, watertight) or `'corner-fit'` (surface-hugging + watertight) if the
   * smooth mesh's open concave seams leak occlusion in practice (combine with
   * {@link occluderDebugStyle} to actually *see* the mesh shape). Only has an
   * effect when {@link persistentOcclusion} is on. Read once when the mesh is
   * wired (Enter-AR / replay load), like the other occupancy knobs. See
   * `GpsPlusSlamJs_Docs/docs/2026-06-30-0829-occluder-tuning-followups.md`.
   */
  occluderMeshMode: OccluderMeshMode;
  /**
   * Camera-local window for the **persistent occluder** snapshot (Step 2 of
   * the 2026-07-03 long-session fps plan): each re-mesh reads only the
   * occupied cells within this many meters of the camera
   * (`OccupancyGrid.getOccupiedCellsWithinFlat`), so snapshot/pack/mesh cost
   * is bounded by the neighbourhood instead of the whole session. Default
   * **25 m** — a 15 cm voxel at 25 m subtends ~0.3°, so occlusion errors
   * beyond that are imperceptible. `0` = unbounded (the pre-Step-2
   * behaviour, the safe fallback). The grid forgets nothing: walking back
   * re-meshes far geometry from memory — exactly the persistent-grid intent.
   * Only has an effect when {@link persistentOcclusion} is on. Read once at
   * Enter-AR / replay load like the other occupancy knobs.
   */
  occluderRadiusM: number;
}

/**
 * Configuration for how captured frame tiles are DISPLAYED in AR (D7-resolution,
 * 2026-06-16 RecorderApp user feedback / Q3). This is **distinct from** the
 * capture setting `images.resolutionDivisor`: capture quality (the JPEG written
 * to the recording) is unchanged — this only downscales the in-AR/replay display
 * texture built from each captured frame, cutting per-tile GPU texture memory.
 *
 * Like {@link OccupancyOptions} it does NOT change what is recorded, so it
 * applies to **both live and replay** (the tile texture is decoded in both). A
 * partial memory mitigation for the OOM/crash track (the tile *count* still
 * grows unbounded — capping/recycling is the separate Track-S fix).
 */
export interface FrameTileDisplayOptions {
  /**
   * Display-texture resolution divisor: 1 = full captured resolution, 2 = half
   * (each dimension), 4 = quarter, 8 = eighth. Default 2 (half). Higher = less
   * GPU memory per tile but a blurrier in-AR preview. Independent of the capture
   * `images.resolutionDivisor`.
   */
  divisor: number;
  /**
   * FIFO cap on the **live** frame-tile planes (Step 4 of the 2026-07-03
   * long-session fps plan): adding a tile over the cap removes + disposes the
   * oldest, bounding draw calls / GPU texture memory / scene-graph size for
   * arbitrarily long sessions while keeping the recent-path breadcrumb.
   * `0` = unlimited. Default 100 (a ~5-min walk captures 112–145 frames, so
   * the cap binds on real walks). **Live only** (2026-07-03 interview): in
   * replay the tiles audit coverage of the full recorded path, so the replay
   * wiring stays uncapped regardless of this value.
   */
  maxTiles: number;
}

/**
 * Visibility toggles for the live AR debug overlays (Finding B / DB-2 of
 * 2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md).
 *
 * These gate **only what is drawn live during recording** — they never change
 * what is captured (frame blobs, depth samples, occupancy data, GPS events all
 * continue regardless) and, with one exception, they never affect replay
 * (where reviewing the captured overlays is the whole point). Read once at
 * Enter-AR: toggling mid-session applies on the next Enter-AR, not
 * retroactively.
 *
 * The debug overlays default ON, so the group is purely additive — every
 * overlay still renders until the operator opts out. The exception on both
 * counts is {@link VisualizationOptions.statsOverlay}: a perf-measurement tool
 * that defaults OFF and, when on, also runs in replay (see its docs).
 */
export interface VisualizationOptions {
  /** Live frame-tile planes (`FrameTileVisualizer`). Default: true */
  frameTiles: boolean;
  /** Voxel depth cubes (`OccupancyCubesVisualizer`). Default: true */
  occupancyCubes: boolean;
  /** Raw/fused/snapshot GPS+VIO alignment spheres (`GpsEventVisualizer`). Default: true */
  gpsAlignmentMarkers: boolean;
  /** N/E/S/W compass orientation cubes (`createGpsCompassCubes`). Default: true */
  compassCubes: boolean;
  /**
   * Rotate the live in-AR minimap so the user's view direction always points
   * up/forward (heading-up) instead of fixed north-up. Unlike the other flags
   * in this group this is a map-orientation preference, not a show/hide — but it
   * shares their live-only semantics (read at Enter-AR, never affects replay).
   * Default: true. See the 2026-06-29 heading-up plan.
   */
  headingUpMap: boolean;
  /**
   * Performance stats overlay (Stats.js: FPS / frame ms / MB panels) for
   * long-session fps attribution (2026-07-03 long-session fps plan §0).
   * Two exceptions to this group's rules: it is a debug tool, so it defaults
   * **OFF** (must not cost the default path), and unlike the live-only
   * overlays it also runs in **replay** (frame time matters there too).
   * In immersive AR it composites via the dom-overlay feature, so it is
   * invisible when `arCrashIsolation.enableDomOverlay` is off.
   */
  statsOverlay: boolean;
}

/**
 * Configuration for live QR detection + RAW recording (decision §0 of the
 * recorder live-QR follow-up,
 * `2026-06-17-2111-recorder-live-qr-next-steps-followup.md`).
 *
 * OPT-IN (`enabled` defaults to `false`): turning it on adds per-frame RGBA
 * capture + a `BarcodeDetector` decode to the session, so it is operator-gated
 * exactly like the heavy `depth`/`images` streams — an existing recording pays
 * nothing. When on, the producer dispatches one RAW `qrDetected/recordQrDetection`
 * action per accepted decode (size + pose are DERIVED on read, never recorded).
 */
export interface QrCaptureOptions {
  /** Whether live QR detection + recording runs. Default: false (opt-in). */
  enabled: boolean;
  /**
   * Capture / detection cadence in ms — the SINGLE cadence owner (the producer
   * runs `minIntervalMs: 0`; this throttles the camera-frame source). Default
   * 125 (~8 Hz), matching the QR demo's `DETECT_INTERVAL_MS`.
   */
  intervalMs: number;
  /**
   * RGBA capture long-edge in px. Larger = more decode range on a small/distant
   * QR but a costlier blit + detect. Default 1024 (the on-device sweep settled
   * here; 512 only decoded small QRs at very close range).
   */
  captureSize: number;
  /**
   * Whether a detected code's LEVEL is downloaded and used during the
   * recording — the synthetic GPS votes that make this session more accurate.
   * Default: false, and deliberately separate from {@link enabled}.
   *
   * Recording detections is safe for any corpus session; CONSUMING levels
   * changes what the session records. A recording made with this on contains
   * synthetic GPS readings alongside the real ones, and today they are NOT
   * reliably distinguishable — the schema field that would mark them exists
   * in the core library but the vote builder cannot set it until that
   * release ships, so the only marker is an id-prefix convention nothing
   * enforces. A corpus recording therefore stays clean unless the operator
   * deliberately wants the comparison.
   */
  useLevels: boolean;
}

/**
 * User-configurable recording options.
 * Persisted to localStorage for cross-session consistency.
 *
 * Deliberately a `type` alias (not an `interface`): object-literal type
 * aliases get an implicit index signature, so a `RecordingOptions` value is
 * assignable to the framework's OPAQUE
 * `SessionMetadata.recordingOptions?: Record<string, unknown>` slot
 * (`state/recording-slice.ts`) without a spread/cast at every dispatch site.
 * An interface would not be (interfaces can be augmented, so TS refuses the
 * implicit index signature).
 */
export type RecordingOptions = {
  /** Depth sampling configuration */
  depth: DepthCaptureOptions;
  /** Image capture configuration */
  images: ImageCaptureOptions;
  /** Diagnostic flags for pre-recording AR crash isolation */
  arCrashIsolation: ArCrashIsolationOptions;
  /** Derived occupancy-grid configuration (voxel size) */
  occupancy: OccupancyOptions;
  /** Frame-tile display-texture resolution (live + replay; capture unchanged) */
  frameTileDisplay: FrameTileDisplayOptions;
  /** Live AR debug-overlay visibility toggles (live-only; replay unaffected) */
  visualization: VisualizationOptions;
  /** Live QR detection + RAW recording configuration (opt-in) */
  qr: QrCaptureOptions;
  /** Compass alignment debug toggles (Stage 0 / Stage C / consistency gate) */
  compassDebug: CompassDebugOptions;
  /** Live loop-closure capture toggles (experimental, default OFF) */
  loopClosureDebug: LoopClosureDebugOptions;
};

// --- Constants ---

/**
 * localStorage key for persisted options.
 *
 * **Multi-tab caveat:** All tabs/instances sharing the same origin will
 * read and write this key. In multi-tab or embedded scenarios, concurrent
 * saves can silently overwrite each other. Use a custom `storageKey`
 * parameter in `loadRecordingOptions` / `saveRecordingOptions` to isolate
 * instances when needed.
 */
export const STORAGE_KEY = 'gps-plus-slam-recorder-options';

/**
 * Default recording options (all streams enabled).
 *
 * **Never hand out this object.** Callers (the settings modal in particular)
 * mutate their options in place, so every path that returns "the defaults"
 * returns a `structuredClone` of it — otherwise a single in-place write would
 * poison the defaults for the rest of the session.
 */
export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  depth: {
    enabled: true,
    // Framework reconstruction cadence — one tuning source shared with the
    // PhysicsDemo (2026-07-16: the demo used the conservative library
    // fallback and reconstructed visibly slower). Values from the maintainer's
    // 2026-07-16 evening on-device framerate/mesh trade-off pass (the
    // sweep-derived 500 ms × 64 built the mesh fastest on ground truth but
    // visibly hurt the framerate — see the constants' doc in
    // ar/depth-sampler.ts for the history).
    intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS, // 200 — five samples per second
    gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE, // 24×24 = 576 points per sample
    rgb: true, // RGB voxel coloring (Iter 8)
  },
  images: {
    enabled: true,
    intervalMs: 2000, // 1 image every 2 seconds
    quality: 0.7, // 70% JPEG quality
    resolutionDivisor: 1, // Full native camera resolution
    // Spread so this default object does not ALIAS DEFAULT_MOTION_FILTER /
    // DEFAULT_CAPTURE_CONFIG.motionFilter — each default group must be its own
    // object so an accidental in-place mutation cannot leak across them.
    motionFilter: { ...DEFAULT_MOTION_FILTER }, // blurry-frame motion gate (on)
    // Same spread/alias rationale — blur/blackness image gate (off by default).
    qualityFilter: { ...DEFAULT_QUALITY_FILTER },
  },
  // Spread so this default group does not ALIAS the framework's
  // DEFAULT_AR_CRASH_ISOLATION (same rationale as the filter groups above).
  arCrashIsolation: { ...DEFAULT_AR_CRASH_ISOLATION },
  occupancy: {
    cellSizeM: DEFAULT_OCCUPANCY_CELL_SIZE_M, // 16 cm voxels — framework default (2026-07-16 EVENING on-device pass, between the sweep-tested 0.15 fidelity and 0.18 speed). Shared with the PhysicsDemo.
    minConfidence: DEFAULT_OCCUPANCY_MIN_OBSERVATIONS, // ≥2 observations to render a voxel — framework noise floor, set by the same 2026-07-16 evening pass (the 07-16-0557 corpus sweep's floor of 3 was measured under LEGACY carving; the decay carve guard closes the floater gap). 1 = legacy/unfiltered. Shared with the PhysicsDemo.
    persistentOcclusion: true, // persistent depth-only mesh occluder ON by default (2026-07-01: Web-Worker offload removed the render stall — see 2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md)
    liveOcclusion: false, // live CPU-depth occluder OFF by default (device-gated quality; replay no-op)
    occluderDebugStyle: 'off', // debug visualization of the persistent occluder mesh OFF by default (occlusion is invisible in normal use)
    occluderMeshMode: 'smooth', // persistent-occluder mesher: Naive Surface Nets by default (smoothest/lightest); 'greedy' = blocky cubes (watertight), 'corner-fit' = surface-hugging + watertight
    occluderRadiusM: 25, // camera-local occluder window (2026-07-03 fps plan Step 2); 0 = unbounded
  },
  frameTileDisplay: {
    // Half-resolution display texture by default (D7): a noticeable per-tile
    // memory saving with little perceptual cost on the small floating tiles.
    divisor: 2,
    // Live FIFO tile cap (2026-07-03 fps plan Step 4); 0 = unlimited.
    maxTiles: 100,
  },
  visualization: {
    // All overlays ON so the group is purely additive (DB-1b) — no behaviour
    // change until the operator opts out.
    frameTiles: true,
    occupancyCubes: true,
    gpsAlignmentMarkers: true,
    compassCubes: true,
    // Heading-up minimap ON by default in live (2026-06-29 user decision).
    headingUpMap: true,
    // Perf stats overlay OFF by default — a debug tool must not cost the
    // default path (2026-07-03 long-session fps plan §0).
    statsOverlay: false,
  },
  qr: {
    // OFF by default (§0): QR capture/detection is opt-in so existing
    // recordings pay nothing (performance must not regress).
    enabled: false,
    intervalMs: 125, // ~8 Hz — the QR demo's DETECT_INTERVAL_MS
    captureSize: 1024, // long-edge px — the on-device-verified default
    useLevels: false,
  },
  compassDebug: {
    // Stage 0 (cold-start compass yaw override) ships ON by default — it is a
    // field-validated, observability-gated handover that orients the world
    // immediately at cold start and hands back to GPS once the yaw is
    // observable. Operator can turn it OFF (e.g. for §6a field-calibration
    // recordings). Stage C + the WebXR-consistency gate stay experimental (OFF).
    coldStartOverride: true,
    rotationPrior: false,
    webXRConsistency: false,
    // 2026-07-19 field-test toggles (enablement plan) — OFF until the
    // operator explicitly opts a session in. voteWeight mirrors the library
    // default (0.1 since 2026-07-20 — the census weight curve measured 0.1 as
    // the whole-session optimum; settings-clarity follow-up §4.6). NOTE:
    // operators with a persisted 0.3 keep it — persisted settings win over
    // this default.
    experiment: false,
    robustSolverComparison: false,
    voteWeight: 0.1,
  },
  loopClosureDebug: {
    // OFF by default: with it ON every AR relocalization jump dispatches
    // arLoopClosureDetected into the recording AND deforms the live
    // alignment — an experimental capture feature until corpus-validated.
    detectorEnabled: false,
  },
};

/** Validation constraints for depth options */
export const DEPTH_CONSTRAINTS = {
  // Min lowered 500 → 100 (2026-07-16, superset-capture strategy — mirrors
  // the images 1000→250 change of 2026-07-10): dense validation recordings
  // (high rate + gridSize 64) are decimated in replay to simulate every
  // slower configuration, so the capture floor must sit below anything worth
  // simulating. The sampler emits at most once per XR frame and skips frames
  // while a sample is due, so an over-ambitious interval degrades gracefully;
  // expect ~200 KB per 64²-sample — zips grow fast below 250 ms. The
  // PRODUCTION default is DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS (200 ms
  // since the 2026-07-16 evening on-device trade-off pass).
  intervalMs: { min: 100, max: 5000, step: 100 },
  // Max 64 (raised 2026-07-01, kept for superset validation recordings):
  // 64×64 = 4096 getDepthInMeters reads per sample. High values trade
  // per-sample depth-readback cost + grid growth for faster cell confirmation;
  // the 2026-07-16 on-device pass settled the PRODUCTION default at 24
  // (DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE) because 64 visibly hurt the
  // framerate.
  gridSize: { min: 2, max: 64, step: 1 },
} as const;

/**
 * Validation constraints for image options.
 *
 * `intervalMs` min/step lowered 1000/500 → 250/250 (2026-07-10) so
 * splat-style object scans can capture up to 4 Hz — at the old 1 Hz floor a
 * slow orbit yields ~1 frame/m, too sparse for Gaussian-splat reconstruction
 * (50–150+ frames/object). An interval faster than the readback+encode path
 * cannot overlap captures: `captureInProgress` serialises them and the
 * interval is measured from the actual capture time, so the pipeline
 * self-limits. See
 * GpsPlusSlamJs_Docs/docs/2026-07-10-0802-splat-orbit-capture-rate-finding.md.
 */
export const IMAGE_CONSTRAINTS = {
  intervalMs: { min: 250, max: 10000, step: 250 },
  quality: { min: 0.3, max: 1.0, step: 0.1 },
  resolutionDivisor: { min: 1, max: 8, step: 1 },
} as const;

/**
 * Validation constraints for occupancy options.
 *
 * `cellSizeM` is clamped to 1–20 cm. The floor exists because cell count (and
 * therefore the cube `InstancedMesh`, the grid `Map`, and the COLMAP
 * `points3D` row count) scales as 1/cellSize³ — sub-centimetre voxels are both
 * a memory/perf cliff on a phone and below the depth sensor's noise floor.
 * Step is 1 cm (the settings slider operates in cm).
 *
 * `minConfidence` is clamped to 1–10 (integer). 1 disables the filter (legacy
 * behaviour: a single observation counts as occupied); the ceiling exists
 * because real surfaces accumulate only a handful of observations per second
 * of dwell, so a floor above ~10 would start hiding genuine geometry.
 */
export const OCCUPANCY_CONSTRAINTS = {
  cellSizeM: { min: 0.01, max: 0.2, step: 0.01 },
  minConfidence: { min: 1, max: 10, step: 1 },
  // Camera-local occluder window: 0 = unbounded; 200 m is far past any
  // useful mobile-AR occlusion distance but keeps a corrupt stored value
  // from effectively disabling the bound by accident.
  occluderRadiusM: { min: 0, max: 200, step: 5 },
} as const;

/**
 * Validation constraints for the frame-tile display-resolution divisor.
 *
 * Clamped to 1–8 (full down to one-eighth per dimension), mirroring the capture
 * `IMAGE_CONSTRAINTS.resolutionDivisor` range so the settings slider behaves the
 * same. The intended stops are 1, 2, 4, 8 (full / half / quarter / eighth); the
 * divisor is rounded to an integer so the resize target dimensions stay clean.
 */
export const FRAME_TILE_DISPLAY_CONSTRAINTS = {
  divisor: { min: 1, max: 8, step: 1 },
  // Live tile cap: 0 = unlimited; 2000 is far past any sane on-device tile
  // budget (each tile is one draw call + one texture) but keeps a corrupt
  // stored value from making the cap effectively unbounded by accident.
  maxTiles: { min: 0, max: 2000, step: 10 },
} as const;

/**
 * Validation constraints for QR-capture options.
 *
 * `intervalMs` is clamped to 50–1000 ms (20 Hz down to 1 Hz): below ~50 ms the
 * detector cannot keep up and frames just queue; above 1 s tracking feels dead.
 * `captureSize` is clamped to 256–2048 px: under 256 even a near QR loses its
 * modules; over 2048 the blit + decode cost is not worth it on a phone. Both
 * back a settings slider so a corrupt stored value can never break capture.
 */
export const QR_CONSTRAINTS = {
  intervalMs: { min: 50, max: 1000, step: 25 },
  captureSize: { min: 256, max: 2048, step: 128 },
} as const;

/** Validation constraints for the compass-debug group's numeric fields */
export const COMPASS_DEBUG_CONSTRAINTS = {
  voteWeight: { min: 0, max: 1, step: 0.05 },
} as const;

/**
 * Validate and normalize the compass alignment debug toggles. Boolean-or-default
 * per field; a missing/corrupted/pre-feature value falls back to the OFF default
 * so a bad persisted value can never silently turn an alignment override ON.
 */
export function validateCompassDebugOptions(
  options: Partial<CompassDebugOptions>
): CompassDebugOptions {
  return validateOptionFields(options, DEFAULT_RECORDING_OPTIONS.compassDebug, {
    coldStartOverride: { kind: 'bool' },
    rotationPrior: { kind: 'bool' },
    webXRConsistency: { kind: 'bool' },
    experiment: { kind: 'bool' },
    robustSolverComparison: { kind: 'bool' },
    voteWeight: {
      kind: 'num',
      constraint: COMPASS_DEBUG_CONSTRAINTS.voteWeight,
    },
  });
}

/**
 * The compass subset of the recorder-store options, keyed by the
 * `createRecorderStore` option names (structurally assignable to
 * `RecorderStoreOptions` — kept local so this options module does not import
 * the store).
 */
export interface CompassStoreOptions {
  enableCompassColdStartOverride?: boolean;
  enableCompassRotationPrior?: boolean;
  enableCompassWebXRConsistency?: boolean;
  enableCompassExperiment?: boolean;
  enableRobustSolverComparison?: boolean;
  compassVoteWeight?: number;
}

/**
 * Map the persisted compass debug toggles onto the `createRecorderStore`
 * option names. The one non-1:1 rule: the vote weight is forwarded ONLY when
 * a rotation prior can consume it (experiment or Stage C on) — a Stage-0-only
 * session must not record a dead `setCompassVoteWeight` action into the
 * session (the slider is inert without a prior; see the 2026-07-20
 * settings-clarity follow-up §3.4).
 *
 * `undefined` input (boot before the options load) yields `{}` — there is
 * simply nothing to map yet.
 *
 * **An explicit `undefined` VALUE is safe here, and the whole chain is what
 * makes it safe** — worth stating because the line above deliberately emits
 * one (`compassVoteWeight: undefined` whenever no prior can consume it), and
 * because this docstring previously claimed the opposite: that spreading
 * explicit-`undefined` keys "would clobber the framework defaults". It does
 * not, and it never did on this path. `createRecorderStore` forwards every
 * option BY NAME rather than spreading over a defaults object, and
 * `createSlamAppStore` then guards `if (compassVoteWeight !== undefined)`, so
 * an explicit `undefined` and an absent key are indistinguishable at every
 * layer. Audited 2026-08-29. If a future consumer ever merges these with
 * `{ ...defaults, ...options }`, THAT is where the hazard would become real.
 */
export function compassStoreOptions(
  compass: CompassDebugOptions | undefined
): CompassStoreOptions {
  if (!compass) return {};
  const priorActive = compass.experiment || compass.rotationPrior;
  return {
    enableCompassColdStartOverride: compass.coldStartOverride,
    enableCompassRotationPrior: compass.rotationPrior,
    enableCompassWebXRConsistency: compass.webXRConsistency,
    enableCompassExperiment: compass.experiment,
    enableRobustSolverComparison: compass.robustSolverComparison,
    compassVoteWeight: priorActive ? compass.voteWeight : undefined,
  };
}

/**
 * Validate and normalize the loop-closure capture toggles. Boolean-or-default
 * per field; a missing/corrupted/pre-feature value falls back to the OFF
 * default so a bad persisted value can never silently wire the detector in.
 */
export function validateLoopClosureDebugOptions(
  options: Partial<LoopClosureDebugOptions>
): LoopClosureDebugOptions {
  return validateOptionFields(
    options,
    DEFAULT_RECORDING_OPTIONS.loopClosureDebug,
    {
      detectorEnabled: { kind: 'bool' },
    }
  );
}

/**
 * Validate and normalize the live debug-overlay visibility toggles.
 * Each field is boolean-or-default (same policy as the AR-crash-isolation
 * flags): a missing, corrupted, or pre-feature persisted value falls back to
 * the ON default so an overlay is never silently disabled by bad input.
 */
export function validateVisualizationOptions(
  options: Partial<VisualizationOptions>
): VisualizationOptions {
  return validateOptionFields(
    options,
    DEFAULT_RECORDING_OPTIONS.visualization,
    {
      frameTiles: { kind: 'bool' },
      occupancyCubes: { kind: 'bool' },
      gpsAlignmentMarkers: { kind: 'bool' },
      compassCubes: { kind: 'bool' },
      headingUpMap: { kind: 'bool' },
      // Same boolean-or-default policy, but the default is OFF (debug tool) — a
      // corrupt value must never switch the overlay on by itself.
      statsOverlay: { kind: 'bool' },
    }
  );
}

// --- Validation ---

/**
 * Validate and normalize QR-capture options. `enabled` is boolean-or-default
 * (a corrupt/pre-feature value falls back to the OFF default so QR never
 * silently turns ON); `intervalMs`/`captureSize` are clamped to
 * {@link QR_CONSTRAINTS}, with a `Number.isFinite` guard so a stored `NaN`
 * (which is `typeof 'number'` and survives `clamp`) falls back to the default
 * rather than breaking the camera-frame source.
 */
export function validateQrOptions(
  options: Partial<QrCaptureOptions>
): QrCaptureOptions {
  return validateOptionFields(options, DEFAULT_RECORDING_OPTIONS.qr, {
    enabled: { kind: 'bool' },
    intervalMs: { kind: 'num', constraint: QR_CONSTRAINTS.intervalMs },
    captureSize: { kind: 'num', constraint: QR_CONSTRAINTS.captureSize },
    useLevels: { kind: 'bool' },
  });
}

/**
 * Validate and normalize depth options.
 * Invalid values are clamped to valid ranges.
 */
export function validateDepthOptions(
  options: Partial<DepthCaptureOptions>
): DepthCaptureOptions {
  return validateOptionFields(options, DEFAULT_RECORDING_OPTIONS.depth, {
    enabled: { kind: 'bool' },
    intervalMs: { kind: 'num', constraint: DEPTH_CONSTRAINTS.intervalMs },
    // gridSize is an N×N grid dimension, so it must be an integer: round here
    // (and fall back to the default for non-finite input) so the sanitizer's
    // output always applies downstream. DepthSampler.updateConfig rejects a
    // fractional gridSize, so without this an out-of-band value would survive
    // validation yet silently fall back to the sampler's default at runtime.
    gridSize: {
      kind: 'num',
      constraint: DEPTH_CONSTRAINTS.gridSize,
      round: true,
    },
    rgb: { kind: 'bool' },
  });
}

/**
 * Validate and normalize image options.
 * Invalid values are clamped to valid ranges.
 */
export function validateImageOptions(
  options: Partial<ImageCaptureOptions>
): ImageCaptureOptions {
  return validateOptionFields(options, DEFAULT_RECORDING_OPTIONS.images, {
    enabled: { kind: 'bool' },
    intervalMs: { kind: 'num', constraint: IMAGE_CONSTRAINTS.intervalMs },
    quality: { kind: 'num', constraint: IMAGE_CONSTRAINTS.quality },
    resolutionDivisor: {
      kind: 'num',
      constraint: IMAGE_CONSTRAINTS.resolutionDivisor,
    },
    // Nested groups: a missing group default-fills entirely, so a pre-feature
    // persisted object that lacks it loads with that gate's defaults rather
    // than crashing.
    motionFilter: {
      kind: 'custom',
      resolve: (opts) => validateMotionFilterConfig(opts.motionFilter),
    },
    qualityFilter: {
      kind: 'custom',
      resolve: (opts) => validateQualityFilterConfig(opts.qualityFilter),
    },
  });
}

/**
 * Validate and normalize occupancy options.
 * Invalid values are clamped to valid ranges.
 *
 * Note why the `num` rule's finiteness check matters here specifically:
 * `OccupancyGrid` throws a `RangeError` on a non-finite cell size, and a bare
 * clamp would pass `NaN` straight through (it is `typeof 'number'`). Falling
 * back to the default keeps a corrupted stored value from crashing grid
 * construction.
 *
 * **Backward-compat migration:** the occlusion options were a single
 * `occlusionMeshEnabled` boolean before 2026-06-29; they are now the two
 * composable booleans `persistentOcclusion` + `liveOcclusion`. A persisted
 * object that predates the split carries only the legacy field, so when the new
 * `persistentOcclusion` is absent we read `occlusionMeshEnabled` and map
 * `true → persistentOcclusion: true` (the old mesh occluder is the persistent
 * one); the legacy shape never enabled a live occluder, so `liveOcclusion`
 * stays at its default. A present new field always wins over the legacy one.
 * See `2026-06-29-1414-occupancy-mesh-followups.md`.
 */
/**
 * Resolve `persistentOcclusion` with legacy migration. A **present** new field
 * always wins over the legacy `occlusionMeshEnabled` — even when its value is
 * invalid: a present-but-corrupt value falls back to the default, never to the
 * legacy flag, so corrupted saved options can't silently flip the occluder
 * against the "new field wins" contract. Only an **absent** new field migrates
 * the legacy boolean (`true → persistent on`); else the default.
 */
function resolvePersistentOcclusion(
  options: Partial<OccupancyOptions>,
  legacyOcclusionMeshEnabled: unknown,
  defaultValue: boolean
): boolean {
  if ('persistentOcclusion' in options) {
    return typeof options.persistentOcclusion === 'boolean'
      ? options.persistentOcclusion
      : defaultValue;
  }
  return typeof legacyOcclusionMeshEnabled === 'boolean'
    ? legacyOcclusionMeshEnabled
    : defaultValue;
}

/**
 * Resolve `occluderDebugStyle` with legacy migration, following the same
 * contract as {@link resolvePersistentOcclusion}: a **present** new field
 * always wins over the legacy `occluderDebugViz` boolean — even when its value
 * is unknown/corrupt it falls back to the default (`'off'`), never to the
 * legacy flag, so corrupted saved options can't silently turn a debug render
 * on. Only an **absent** new field migrates the legacy boolean
 * (`true → 'matcap'`, the skin the boolean used to enable); else the default.
 */
function resolveOccluderDebugStyle(
  options: Partial<OccupancyOptions>,
  legacyOccluderDebugViz: unknown,
  defaultValue: OccluderDebugStyle
): OccluderDebugStyle {
  if ('occluderDebugStyle' in options) {
    return (OCCLUDER_DEBUG_STYLES as readonly unknown[]).includes(
      options.occluderDebugStyle
    )
      ? (options.occluderDebugStyle as OccluderDebugStyle)
      : defaultValue;
  }
  if (typeof legacyOccluderDebugViz === 'boolean') {
    return legacyOccluderDebugViz ? 'matcap' : 'off';
  }
  return defaultValue;
}

export function validateOccupancyOptions(
  options: Partial<OccupancyOptions>
): OccupancyOptions {
  return validateOptionFields(options, DEFAULT_RECORDING_OPTIONS.occupancy, {
    cellSizeM: { kind: 'num', constraint: OCCUPANCY_CONSTRAINTS.cellSizeM },
    // Rounded so a fractional stored value resolves to a valid integer
    // threshold (getOccupiedCells expects an int).
    minConfidence: {
      kind: 'num',
      constraint: OCCUPANCY_CONSTRAINTS.minConfidence,
      round: true,
    },
    // Present new field wins (even if invalid → default); absent → migrate the
    // legacy `occlusionMeshEnabled` boolean. See resolvePersistentOcclusion.
    persistentOcclusion: {
      kind: 'custom',
      resolve: (opts, fallback) =>
        resolvePersistentOcclusion(
          opts,
          (opts as { occlusionMeshEnabled?: unknown }).occlusionMeshEnabled,
          fallback
        ),
    },
    // The legacy single-toggle never drove a live occluder, so there is nothing
    // to migrate here — boolean-or-default only.
    liveOcclusion: { kind: 'bool' },
    // Present new field wins (unknown value → default 'off'); absent → migrate
    // the legacy `occluderDebugViz` boolean. See resolveOccluderDebugStyle.
    occluderDebugStyle: {
      kind: 'custom',
      resolve: (opts, fallback) =>
        resolveOccluderDebugStyle(
          opts,
          (opts as { occluderDebugViz?: unknown }).occluderDebugViz,
          fallback
        ),
    },
    // Enum-or-default: only one of the known mesher modes is accepted; anything
    // else (corrupt/legacy/missing) falls back to the default blocky cubes.
    occluderMeshMode: { kind: 'enum', values: OCCLUDER_MESH_MODES },
    // 0 stays 0 (the explicit "unbounded"). Rounded to whole meters — the grid
    // throws on invalid radii, so garbage must never pass through.
    occluderRadiusM: {
      kind: 'num',
      constraint: OCCUPANCY_CONSTRAINTS.occluderRadiusM,
      round: true,
    },
  });
}

/**
 * Validate and normalize frame-tile display options. `divisor` is clamped to
 * {@link FRAME_TILE_DISPLAY_CONSTRAINTS} and rounded to an integer, with a
 * `Number.isFinite` guard so a stored `NaN` (which is `typeof 'number'` and
 * survives `clamp`) falls back to the default rather than producing a broken
 * resize target.
 */
export function validateFrameTileDisplayOptions(
  options: Partial<FrameTileDisplayOptions>
): FrameTileDisplayOptions {
  return validateOptionFields(
    options,
    DEFAULT_RECORDING_OPTIONS.frameTileDisplay,
    {
      divisor: {
        kind: 'num',
        constraint: FRAME_TILE_DISPLAY_CONSTRAINTS.divisor,
        round: true,
      },
      // Same policy; 0 stays 0 (the explicit "unlimited").
      maxTiles: {
        kind: 'num',
        constraint: FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles,
        round: true,
      },
    }
  );
}

/**
 * Validate and normalize a full RecordingOptions object.
 * Merges with defaults and clamps invalid values.
 *
 * The `arCrashIsolation` group delegates to the FRAMEWORK's
 * `validateArCrashIsolationOptions` (`ar/ar-crash-isolation.ts`) — the
 * framework owns that group's type/defaults/validator because it consumes the
 * flags itself in `webxr-session.ts`.
 */
export function validateRecordingOptions(
  options: RecordingOptionsInput
): RecordingOptions {
  return {
    depth: validateDepthOptions(options.depth ?? {}),
    images: validateImageOptions(options.images ?? {}),
    arCrashIsolation: validateArCrashIsolationOptions(
      options.arCrashIsolation ?? {}
    ),
    occupancy: validateOccupancyOptions(options.occupancy ?? {}),
    frameTileDisplay: validateFrameTileDisplayOptions(
      options.frameTileDisplay ?? {}
    ),
    visualization: validateVisualizationOptions(options.visualization ?? {}),
    qr: validateQrOptions(options.qr ?? {}),
    compassDebug: validateCompassDebugOptions(options.compassDebug ?? {}),
    loopClosureDebug: validateLoopClosureDebugOptions(
      options.loopClosureDebug ?? {}
    ),
  };
}

// --- Persistence ---

/**
 * Load recording options from localStorage.
 * Returns defaults if no saved options exist or parsing fails.
 * Validates and merges with defaults to handle schema evolution.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function loadRecordingOptions(
  storageKey: string = STORAGE_KEY
): RecordingOptions {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as RecordingOptionsInput;
      log.debug('Loaded options from storage:', parsed);
      return validateRecordingOptions(parsed);
    }
  } catch (err) {
    log.warn('Failed to load recording options:', err);
  }
  log.debug('Using default recording options');
  return structuredClone(DEFAULT_RECORDING_OPTIONS);
}

/**
 * Save recording options to localStorage.
 * Options are validated before saving.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function saveRecordingOptions(
  options: RecordingOptions,
  storageKey: string = STORAGE_KEY
): void {
  try {
    const validated = validateRecordingOptions(options);
    localStorage.setItem(storageKey, JSON.stringify(validated));
    log.debug('Saved recording options:', validated);
  } catch (err) {
    log.warn('Failed to save recording options:', err);
  }
}

/**
 * Reset recording options to defaults.
 * Clears localStorage and returns default options.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function resetRecordingOptions(
  storageKey: string = STORAGE_KEY
): RecordingOptions {
  try {
    localStorage.removeItem(storageKey);
    log.debug('Reset recording options to defaults');
  } catch (err) {
    log.warn('Failed to clear recording options from storage:', err);
  }
  return structuredClone(DEFAULT_RECORDING_OPTIONS);
}
