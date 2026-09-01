/**
 * Settings Modal - UI for configuring recording options.
 *
 * The option↔DOM wiring is declarative: `OPTION_BINDINGS` maps each form
 * control (by element id) to its `RecordingOptions` field, slider bounds,
 * label formatter and enabled-state rule. `initSettingsModal` binds the table
 * once (element lookup + listener + slider bounds from the validation
 * constraints), and populate/refresh re-read it. Adding an option means adding
 * ONE table entry plus the HTML — never a hand-written handler/populate pair.
 * A dead control (typo'd id) is caught by the binding-completeness test.
 */

import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
  DEPTH_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  MOTION_FILTER_CONSTRAINTS,
  QUALITY_FILTER_CONSTRAINTS,
  OCCUPANCY_CONSTRAINTS,
  FRAME_TILE_DISPLAY_CONSTRAINTS,
  QR_CONSTRAINTS,
  COMPASS_DEBUG_CONSTRAINTS,
  type RecordingOptions,
  type OccluderMeshMode,
  type OccluderDebugStyle,
} from '../state/recording-options';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  BLUR_METRIC_IDS,
  type BlurMetricId,
} from 'gps-plus-slam-app-framework/ar/image-quality';
import { getBuildInfo } from '../utils/build-info';
import { showConfirmDialog } from './confirm-dialog';
import { guardSliderAgainstScroll } from 'gps-plus-slam-app-framework/utils/slider-scroll-guard';

const log = createLogger('SettingsModal');

// --- Label formatters ---

/**
 * Image-interval display: sub-second values (possible since the 250 ms
 * IMAGE_CONSTRAINTS minimum, 2026-07-10 splat-orbit finding) show exact
 * milliseconds — `(250/1000).toFixed(1)` would render a misleading "0.3s".
 * Values ≥1s use just enough decimals for the 250 ms slider step: one for
 * half-second multiples ("1.5s", "2.0s"), two otherwise ("1.25s", "1.75s") —
 * `toFixed(1)` alone would round 1250 to a misleading "1.3s" (PR #178 review).
 */
function formatImageInterval(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const decimals = ms % 500 === 0 ? 1 : 2;
  return `${(ms / 1000).toFixed(decimals)}s`;
}

/** Label for the live frame-tile cap: 0 is the explicit "unlimited". */
function formatMaxTiles(maxTiles: number): string {
  return maxTiles === 0 ? 'unlimited' : String(maxTiles);
}

/** Label for the occluder window: 0 is the explicit "unlimited". */
function formatOccluderRadius(radiusM: number): string {
  return radiusM === 0 ? 'unlimited' : `${radiusM} m`;
}

/**
 * Format the resolution divisor value for display.
 * 1 → "1× (full)", 2 → "÷2 (half)", 4 → "÷4 (quarter)", etc.
 */
function formatResolutionDivisor(divisor: number): string {
  if (divisor <= 1) {
    return '1× (full)';
  }
  if (divisor === 2) {
    return '÷2 (half)';
  }
  if (divisor === 4) {
    return '÷4 (quarter)';
  }
  return `÷${divisor}`;
}

/**
 * Format an angular-velocity threshold (rad/s) for display, adding the
 * equivalent in deg/s in parentheses since degrees-per-second is the more
 * intuitive unit for "how fast am I turning the phone".
 */
function formatAngularVelocity(radPerSec: number): string {
  const degPerSec = Math.round((radPerSec * 180) / Math.PI);
  return `${radPerSec.toFixed(2)} rad/s (≈${degPerSec}°/s)`;
}

/**
 * Format the relative blur threshold `k` (a fraction of the recent sharpness
 * median; a frame is dropped when sharpness < k·median). Higher = stricter
 * (drops more), so label it as the percentage-of-median cutoff.
 */
function formatBlurThreshold(k: number): string {
  return `${k.toFixed(2)} (drop < ${Math.round(k * 100)}% of median)`;
}

/**
 * Format the absolute black cutoff (0–255 mean luma). 0 disables the black
 * check, so call that out.
 */
function formatMinLuminance(luma: number): string {
  const rounded = Math.round(luma);
  return rounded === 0 ? '0 (off)' : `${rounded} / 255`;
}

// --- Declarative option↔DOM binding table ---

/**
 * Enabled-state rule for a control. Reads the CURRENT DOM state of the
 * controlling checkboxes (not the working copy) — gating must stay evaluable
 * even while the modal is hidden and no working copy exists (pinned by the
 * compass-gating tests), and the DOM mirrors the working copy whenever the
 * modal is open.
 */
type OptionPredicate = () => boolean;

interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

interface CheckboxBinding {
  kind: 'checkbox';
  id: string;
  get: (options: RecordingOptions) => boolean;
  set: (options: RecordingOptions, value: boolean) => void;
  enabledWhen?: OptionPredicate;
}

interface SliderBinding {
  kind: 'slider';
  id: string;
  /**
   * Slider min/max/step, in SLIDER units (after `toSlider`). Sourced from the
   * validation constraints — one source of truth, so the UI can never offer a
   * value the validator would clamp away.
   */
  range: SliderRange;
  get: (options: RecordingOptions) => number;
  set: (options: RecordingOptions, value: number) => void;
  /** Model → slider units (e.g. metres → cm). Identity when omitted. */
  toSlider?: (model: number) => number;
  /** Slider → model units. Identity when omitted. */
  fromSlider?: (slider: number) => number;
  /** Text for the sibling `${id}-value` label, from the MODEL value. */
  format: (model: number) => string;
  enabledWhen?: OptionPredicate;
}

interface SelectBinding {
  kind: 'select';
  id: string;
  get: (options: RecordingOptions) => string;
  set: (options: RecordingOptions, value: string) => void;
  enabledWhen?: OptionPredicate;
}

type OptionBinding = CheckboxBinding | SliderBinding | SelectBinding;

/** DOM read for the gating rules; `fallback` applies when the element is absent. */
function isChecked(id: string, fallback: boolean): boolean {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el.checked : fallback;
}

// Enabled-state rules. Sub-controls grey out while their parent toggle is off.
const depthOn: OptionPredicate = () => isChecked('depth-enabled', true);
const imagesOn: OptionPredicate = () => isChecked('images-enabled', true);
// The motion/quality threshold controls require BOTH capture and their gate on.
const motionGateOn: OptionPredicate = () =>
  imagesOn() && isChecked('images-motion-filter', true);
const qualityGateOn: OptionPredicate = () =>
  imagesOn() && isChecked('images-quality-filter', false);
// QR is opt-in (default off), so its sliders start disabled until enabled.
const qrOn: OptionPredicate = () => isChecked('qr-enabled', false);
// Compass gating (2026-07-20 settings-clarity follow-up §4.2/§4.6):
// - The vote-weight slider is inert unless the experiment or Stage C is on —
//   mirrors `compassStoreOptions`, which only forwards the weight when a
//   rotation prior can consume it.
// - The experiment IMPLIES Stage C (at the 15° trust tolerance), so Stage C
//   greys out while the experiment is on. Its stored value is deliberately
//   KEPT and both flags keep being persisted/recorded (keep-value-record-both).
const compassPriorConsumerOn: OptionPredicate = () =>
  isChecked('compass-experiment', false) ||
  isChecked('compass-rotation-prior', false);
const compassExperimentOff: OptionPredicate = () =>
  !isChecked('compass-experiment', false);

const OPTION_BINDINGS: readonly OptionBinding[] = [
  // Depth sampling
  {
    kind: 'checkbox',
    id: 'depth-enabled',
    get: (o) => o.depth.enabled,
    set: (o, v) => {
      o.depth.enabled = v;
    },
  },
  {
    kind: 'slider',
    id: 'depth-interval',
    range: DEPTH_CONSTRAINTS.intervalMs,
    get: (o) => o.depth.intervalMs,
    set: (o, v) => {
      o.depth.intervalMs = v;
    },
    format: (v) => `${(v / 1000).toFixed(1)}s`,
    enabledWhen: depthOn,
  },
  {
    kind: 'slider',
    id: 'depth-grid',
    range: DEPTH_CONSTRAINTS.gridSize,
    get: (o) => o.depth.gridSize,
    set: (o, v) => {
      o.depth.gridSize = v;
    },
    format: (v) => `${v}×${v}`,
    enabledWhen: depthOn,
  },
  {
    kind: 'checkbox',
    id: 'depth-rgb',
    get: (o) => o.depth.rgb,
    set: (o, v) => {
      o.depth.rgb = v;
    },
    enabledWhen: depthOn,
  },

  // Image capture
  {
    kind: 'checkbox',
    id: 'images-enabled',
    get: (o) => o.images.enabled,
    set: (o, v) => {
      o.images.enabled = v;
    },
  },
  {
    kind: 'slider',
    id: 'images-interval',
    range: IMAGE_CONSTRAINTS.intervalMs,
    get: (o) => o.images.intervalMs,
    set: (o, v) => {
      o.images.intervalMs = v;
    },
    format: formatImageInterval,
    enabledWhen: imagesOn,
  },
  {
    kind: 'slider',
    id: 'images-quality',
    range: IMAGE_CONSTRAINTS.quality,
    get: (o) => o.images.quality,
    set: (o, v) => {
      o.images.quality = v;
    },
    format: (v) => `${Math.round(v * 100)}%`,
    enabledWhen: imagesOn,
  },
  {
    kind: 'slider',
    id: 'images-resolution-divisor',
    range: IMAGE_CONSTRAINTS.resolutionDivisor,
    get: (o) => o.images.resolutionDivisor,
    set: (o, v) => {
      o.images.resolutionDivisor = v;
    },
    format: formatResolutionDivisor,
    enabledWhen: imagesOn,
  },

  // Blurry-frame motion gate (2026-06-23 motion-gating plan). Thresholds are
  // stored in rad/s and m/s (the units the gate compares against), so the
  // slider value IS the stored value.
  {
    kind: 'checkbox',
    id: 'images-motion-filter',
    get: (o) => o.images.motionFilter.enabled,
    set: (o, v) => {
      o.images.motionFilter.enabled = v;
    },
    enabledWhen: imagesOn,
  },
  {
    kind: 'slider',
    id: 'images-max-angular',
    range: MOTION_FILTER_CONSTRAINTS.maxAngularVelocity,
    get: (o) => o.images.motionFilter.maxAngularVelocity,
    set: (o, v) => {
      o.images.motionFilter.maxAngularVelocity = v;
    },
    format: formatAngularVelocity,
    enabledWhen: motionGateOn,
  },
  {
    kind: 'slider',
    id: 'images-max-linear',
    range: MOTION_FILTER_CONSTRAINTS.maxLinearVelocity,
    get: (o) => o.images.motionFilter.maxLinearVelocity,
    set: (o, v) => {
      o.images.motionFilter.maxLinearVelocity = v;
    },
    format: (v) => `${v.toFixed(2)} m/s`,
    enabledWhen: motionGateOn,
  },

  // Image-quality gate (blur/blackness): thresholds stored exactly as the
  // slider value (a 0–1 fraction for blur, a 0–255 luma cutoff for blackness).
  {
    kind: 'checkbox',
    id: 'images-quality-filter',
    get: (o) => o.images.qualityFilter.enabled,
    set: (o, v) => {
      o.images.qualityFilter.enabled = v;
    },
    enabledWhen: imagesOn,
  },
  {
    kind: 'select',
    id: 'images-blur-metric',
    // Persisted pre-toggle options may lack blurMetric — render the default.
    get: (o) => o.images.qualityFilter.blurMetric ?? 'variance-of-laplacian',
    // Membership-check rather than trusting the DOM value — save-time
    // validation would catch it too, but never let an invalid id sit in the
    // working copy.
    set: (o, v) => {
      o.images.qualityFilter.blurMetric = BLUR_METRIC_IDS.includes(
        v as BlurMetricId
      )
        ? (v as BlurMetricId)
        : 'variance-of-laplacian';
    },
    enabledWhen: qualityGateOn,
  },
  {
    kind: 'slider',
    id: 'images-blur-threshold',
    range: QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold,
    get: (o) => o.images.qualityFilter.blurRelativeThreshold,
    set: (o, v) => {
      o.images.qualityFilter.blurRelativeThreshold = v;
    },
    format: formatBlurThreshold,
    enabledWhen: qualityGateOn,
  },
  {
    kind: 'slider',
    id: 'images-min-luminance',
    range: QUALITY_FILTER_CONSTRAINTS.minMeanLuminance,
    get: (o) => o.images.qualityFilter.minMeanLuminance,
    set: (o, v) => {
      o.images.qualityFilter.minMeanLuminance = v;
    },
    format: formatMinLuminance,
    enabledWhen: qualityGateOn,
  },

  // AR crash isolation (Phase 1 diagnostic flags)
  {
    kind: 'checkbox',
    id: 'ar-dom-overlay-enabled',
    get: (o) => o.arCrashIsolation.enableDomOverlay,
    set: (o, v) => {
      o.arCrashIsolation.enableDomOverlay = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'ar-camera-access-enabled',
    get: (o) => o.arCrashIsolation.enableCameraAccess,
    set: (o, v) => {
      o.arCrashIsolation.enableCameraAccess = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'ar-depth-sensing-enabled',
    get: (o) => o.arCrashIsolation.enableDepthSensingFeature,
    set: (o, v) => {
      o.arCrashIsolation.enableDepthSensingFeature = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'ar-css3d-enabled',
    get: (o) => o.arCrashIsolation.enableCss3dRenderer,
    set: (o, v) => {
      o.arCrashIsolation.enableCss3dRenderer = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'ar-camera-texture-enabled',
    get: (o) => o.arCrashIsolation.enableCameraTextureAcquisition,
    set: (o, v) => {
      o.arCrashIsolation.enableCameraTextureAcquisition = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'ar-chromium-projection-layer-workaround',
    get: (o) => o.arCrashIsolation.applyChromiumProjectionLayerWorkaround,
    set: (o, v) => {
      o.arCrashIsolation.applyChromiumProjectionLayerWorkaround = v;
    },
  },

  // Occupancy grid. The voxel-size slider operates in centimetres for
  // readability; the stored option (occupancy.cellSizeM) is metres — a unit
  // mismatch would silently feed the grid a 100× wrong cell size, so both
  // directions are unit-tested.
  {
    kind: 'slider',
    id: 'occupancy-cell-size',
    range: {
      min: OCCUPANCY_CONSTRAINTS.cellSizeM.min * 100,
      max: OCCUPANCY_CONSTRAINTS.cellSizeM.max * 100,
      step: OCCUPANCY_CONSTRAINTS.cellSizeM.step * 100,
    },
    get: (o) => o.occupancy.cellSizeM,
    set: (o, v) => {
      o.occupancy.cellSizeM = v;
    },
    toSlider: (m) => Math.round(m * 100),
    fromSlider: (cm) => cm / 100,
    format: (m) => `${Math.round(m * 100)} cm`,
  },
  // Voxel noise filter: minimum observations before a cell is rendered;
  // 1 = unfiltered.
  {
    kind: 'slider',
    id: 'occupancy-min-confidence',
    range: OCCUPANCY_CONSTRAINTS.minConfidence,
    get: (o) => o.occupancy.minConfidence,
    set: (o, v) => {
      o.occupancy.minConfidence = v;
    },
    format: (n) => (n === 1 ? '1 (unfiltered)' : String(n)),
  },
  // Live CPU-depth occluder — live-AR only; applies on the next Enter-AR and
  // composes with the persistent mesh (both can be on).
  {
    kind: 'checkbox',
    id: 'occupancy-live-occlusion',
    get: (o) => o.occupancy.liveOcclusion,
    set: (o, v) => {
      o.occupancy.liveOcclusion = v;
    },
  },
  // Persistent depth-only occlusion mesh — applies on the next Enter-AR /
  // replay load, like the voxel-size knobs.
  {
    kind: 'checkbox',
    id: 'occupancy-persistent-occlusion',
    get: (o) => o.occupancy.persistentOcclusion,
    set: (o, v) => {
      o.occupancy.persistentOcclusion = v;
    },
  },
  // Debug-visualization style of the persistent occluder mesh (off / matcap /
  // depth-shaded / wireframe / both). Validated on save — an unknown <option>
  // value resolves to 'off'.
  {
    kind: 'select',
    id: 'occupancy-occluder-debug-style',
    get: (o) => o.occupancy.occluderDebugStyle,
    set: (o, v) => {
      o.occupancy.occluderDebugStyle = v as OccluderDebugStyle;
    },
  },
  // Persistent-occluder mesher style (blocky / corner-fit / surface nets) for
  // on-device A/B tests. Validated on save — an unexpected <option> value
  // resolves to the default.
  {
    kind: 'select',
    id: 'occupancy-occluder-mesh-mode',
    get: (o) => o.occupancy.occluderMeshMode,
    set: (o, v) => {
      o.occupancy.occluderMeshMode = v as OccluderMeshMode;
    },
  },
  // Camera-local occluder window (Step 2, 2026-07-03 long-session fps plan);
  // 0 = unlimited. Applies on the next Enter-AR / replay load.
  {
    kind: 'slider',
    id: 'occupancy-occluder-radius',
    range: OCCUPANCY_CONSTRAINTS.occluderRadiusM,
    get: (o) => o.occupancy.occluderRadiusM,
    set: (o, v) => {
      o.occupancy.occluderRadiusM = v;
    },
    format: formatOccluderRadius,
  },

  // Frame-tile DISPLAY resolution (D7-resolution) — distinct from the capture
  // images.resolutionDivisor; only downscales the in-AR/replay tile texture to
  // save GPU memory. Reuses the same ÷N label formatter.
  {
    kind: 'slider',
    id: 'frame-tile-display-divisor',
    range: FRAME_TILE_DISPLAY_CONSTRAINTS.divisor,
    get: (o) => o.frameTileDisplay.divisor,
    set: (o, v) => {
      o.frameTileDisplay.divisor = v;
    },
    format: formatResolutionDivisor,
  },
  // Live frame-tile FIFO cap (Step 4, 2026-07-03 long-session fps plan).
  // Live-only: replay never applies it (full-path coverage auditing).
  {
    kind: 'slider',
    id: 'frame-tile-max-tiles',
    range: FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles,
    get: (o) => o.frameTileDisplay.maxTiles,
    set: (o, v) => {
      o.frameTileDisplay.maxTiles = v;
    },
    format: formatMaxTiles,
  },

  // Live debug-overlay toggles (Finding B). Each gates only what is drawn live
  // during recording; replay is unaffected. Read once at the next Enter-AR.
  {
    kind: 'checkbox',
    id: 'viz-frame-tiles',
    get: (o) => o.visualization.frameTiles,
    set: (o, v) => {
      o.visualization.frameTiles = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'viz-occupancy-cubes',
    get: (o) => o.visualization.occupancyCubes,
    set: (o, v) => {
      o.visualization.occupancyCubes = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'viz-gps-alignment-markers',
    get: (o) => o.visualization.gpsAlignmentMarkers,
    set: (o, v) => {
      o.visualization.gpsAlignmentMarkers = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'viz-compass-cubes',
    get: (o) => o.visualization.compassCubes,
    set: (o, v) => {
      o.visualization.compassCubes = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'viz-heading-up-map',
    get: (o) => o.visualization.headingUpMap,
    set: (o, v) => {
      o.visualization.headingUpMap = v;
    },
  },
  // Stats.js perf panels — unlike its siblings this one also applies to replay
  // (Step 0 of the 2026-07-03 long-session fps plan).
  {
    kind: 'checkbox',
    id: 'viz-stats-overlay',
    get: (o) => o.visualization.statsOverlay,
    set: (o, v) => {
      o.visualization.statsOverlay = v;
    },
  },

  // Compass alignment debug toggles (Phase-4). Feed the absolute-orientation
  // compass into the live GPS alignment; applied on the next session/reload.
  {
    kind: 'checkbox',
    id: 'compass-cold-start-override',
    get: (o) => o.compassDebug.coldStartOverride,
    set: (o, v) => {
      o.compassDebug.coldStartOverride = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'compass-rotation-prior',
    get: (o) => o.compassDebug.rotationPrior,
    set: (o, v) => {
      o.compassDebug.rotationPrior = v;
    },
    enabledWhen: compassExperimentOff,
  },
  {
    kind: 'checkbox',
    id: 'compass-webxr-consistency',
    get: (o) => o.compassDebug.webXRConsistency,
    set: (o, v) => {
      o.compassDebug.webXRConsistency = v;
    },
  },
  // 2026-07-19 field-test toggles (enablement plan): experiment combo + the
  // alternative robust-solver comparison arm.
  {
    kind: 'checkbox',
    id: 'compass-experiment',
    get: (o) => o.compassDebug.experiment,
    set: (o, v) => {
      o.compassDebug.experiment = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'compass-robust-solver-comparison',
    get: (o) => o.compassDebug.robustSolverComparison,
    set: (o, v) => {
      o.compassDebug.robustSolverComparison = v;
    },
  },
  {
    kind: 'slider',
    id: 'compass-vote-weight',
    range: COMPASS_DEBUG_CONSTRAINTS.voteWeight,
    get: (o) => o.compassDebug.voteWeight,
    set: (o, v) => {
      o.compassDebug.voteWeight = v;
    },
    format: (v) => v.toFixed(2),
    enabledWhen: compassPriorConsumerOn,
  },

  // Loop-closure capture (experimental, default OFF). Applied on the next
  // session — the detector wiring is read once at Enter AR.
  {
    kind: 'checkbox',
    id: 'loop-closure-detector',
    get: (o) => o.loopClosureDebug.detectorEnabled,
    set: (o, v) => {
      o.loopClosureDebug.detectorEnabled = v;
    },
  },

  // QR detection (recorder live-QR WS-2/WS-5). Opt-in; the interval + capture
  // sliders are gated on the enabled checkbox (mirrors depth/images).
  {
    kind: 'checkbox',
    id: 'qr-enabled',
    get: (o) => o.qr.enabled,
    set: (o, v) => {
      o.qr.enabled = v;
    },
  },
  {
    kind: 'checkbox',
    id: 'qr-use-levels',
    get: (o) => o.qr.useLevels,
    set: (o, v) => {
      o.qr.useLevels = v;
    },
    enabledWhen: qrOn,
  },
  {
    kind: 'slider',
    id: 'qr-interval',
    range: QR_CONSTRAINTS.intervalMs,
    get: (o) => o.qr.intervalMs,
    set: (o, v) => {
      o.qr.intervalMs = v;
    },
    format: (v) => `${v} ms`,
    enabledWhen: qrOn,
  },
  {
    kind: 'slider',
    id: 'qr-capture-size',
    range: QR_CONSTRAINTS.captureSize,
    get: (o) => o.qr.captureSize,
    set: (o, v) => {
      o.qr.captureSize = v;
    },
    format: (v) => `${v} px`,
    enabledWhen: qrOn,
  },
];

// --- Binding engine ---

/** A table entry resolved to its live DOM element(s). */
type BoundControl =
  | { kind: 'checkbox'; binding: CheckboxBinding; input: HTMLInputElement }
  | {
      kind: 'slider';
      binding: SliderBinding;
      input: HTMLInputElement;
      label: HTMLElement | null;
    }
  | { kind: 'select'; binding: SelectBinding; input: HTMLSelectElement };

/** Resolved controls; rebuilt on every `initSettingsModal`. */
let boundControls: BoundControl[] = [];

/**
 * Resolve one table entry against the DOM. Returns null (control stays inert)
 * when the element is missing or of the wrong type — the binding-completeness
 * test guards against this happening in production HTML.
 */
function resolveBinding(binding: OptionBinding): BoundControl | null {
  const el = document.getElementById(binding.id);
  switch (binding.kind) {
    case 'checkbox':
      return el instanceof HTMLInputElement
        ? { kind: 'checkbox', binding, input: el }
        : null;
    case 'slider':
      return el instanceof HTMLInputElement
        ? {
            kind: 'slider',
            binding,
            input: el,
            label: document.getElementById(`${binding.id}-value`),
          }
        : null;
    case 'select':
      return el instanceof HTMLSelectElement
        ? { kind: 'select', binding, input: el }
        : null;
  }
}

/** Look up all bound elements, apply slider bounds, attach listeners. */
function bindOptionControls(): void {
  boundControls = [];
  for (const binding of OPTION_BINDINGS) {
    const control = resolveBinding(binding);
    if (!control) {
      log.warn(`Settings control #${binding.id} not found in DOM`);
      continue;
    }
    if (control.kind === 'slider') {
      const { min, max, step } = control.binding.range;
      control.input.min = String(min);
      control.input.max = String(max);
      control.input.step = String(step);
      // Installed BEFORE the binding listener below: at-target listeners run in
      // registration order, which is what lets the guard stop a scroll-gesture
      // `input` event before this modal reacts to it (2026-07-27 feedback —
      // swiping the panel used to edit whatever slider sat under the finger).
      guardSliderAgainstScroll(control.input);
    }
    boundControls.push(control);
    // Sliders update continuously while dragging; checkboxes/selects on commit.
    const eventName = control.kind === 'slider' ? 'input' : 'change';
    control.input.addEventListener(eventName, () => {
      handleControlChange(control);
    });
  }
}

/**
 * Write one control's DOM value into the working copy and refresh the UI.
 * The working-copy write is skipped while the modal is hidden (no working
 * copy), but gating always refreshes — it reads the DOM, not the copy.
 */
function handleControlChange(control: BoundControl): void {
  if (workingOptions) {
    switch (control.kind) {
      case 'checkbox':
        control.binding.set(workingOptions, control.input.checked);
        break;
      case 'slider': {
        const sliderValue = Number(control.input.value);
        if (!Number.isFinite(sliderValue)) {
          break; // defensive: never write NaN into the working copy
        }
        const { binding, label } = control;
        binding.set(
          workingOptions,
          binding.fromSlider ? binding.fromSlider(sliderValue) : sliderValue
        );
        if (label) {
          label.textContent = binding.format(binding.get(workingOptions));
        }
        break;
      }
      case 'select':
        control.binding.set(workingOptions, control.input.value);
        break;
    }
  }
  refreshControlStates();
}

/** Push `options` into every bound control (values, labels, enabled states). */
function populateForm(options: RecordingOptions): void {
  for (const control of boundControls) {
    switch (control.kind) {
      case 'checkbox':
        control.input.checked = control.binding.get(options);
        break;
      case 'slider': {
        const { binding, input, label } = control;
        const model = binding.get(options);
        input.value = String(
          binding.toSlider ? binding.toSlider(model) : model
        );
        if (label) {
          label.textContent = binding.format(model);
        }
        break;
      }
      case 'select':
        control.input.value = control.binding.get(options);
        break;
    }
  }
  refreshControlStates();
}

/** Re-evaluate every `enabledWhen` rule against the current DOM state. */
function refreshControlStates(): void {
  for (const { binding, input } of boundControls) {
    if (binding.enabledWhen) {
      input.disabled = !binding.enabledWhen();
    }
  }
}

// --- State ---

/** Current working copy of options (not saved until user clicks Save) */
let workingOptions: RecordingOptions | null = null;

/** Callback to notify when options are saved */
let onOptionsChanged: ((options: RecordingOptions) => void) | null = null;

/** Callback to clear the reference-point cache across all scenarios */
let onClearRefPointCache: (() => void | Promise<void>) | null = null;

/** Modal container element */
let modal: HTMLElement | null = null;

// --- Initialization ---

/**
 * Initialize the settings modal.
 * Should be called once after DOM is ready.
 *
 * @param changeCallback - Called when options are saved
 */
export function initSettingsModal(
  changeCallback?: (options: RecordingOptions) => void,
  clearRefPointCacheCallback?: () => void | Promise<void>
): void {
  onOptionsChanged = changeCallback ?? null;
  onClearRefPointCache = clearRefPointCacheCallback ?? null;

  modal = document.getElementById('settings-modal');
  if (!modal) {
    log.warn('Settings modal element not found in DOM');
    return;
  }

  // Option controls: one table drives lookup, listeners, bounds, labels and
  // enabled-state rules (see OPTION_BINDINGS above).
  bindOptionControls();

  // Buttons and backdrop keep bespoke wiring — they are actions, not options.
  document
    .getElementById('btn-settings')
    ?.addEventListener('click', showSettingsModal);
  document
    .getElementById('btn-settings-close')
    ?.addEventListener('click', hideSettingsModal);
  document
    .getElementById('btn-settings-save')
    ?.addEventListener('click', handleSave);
  document
    .getElementById('btn-settings-reset')
    ?.addEventListener('click', handleReset);
  document
    .getElementById('btn-ar-minimal-baseline')
    ?.addEventListener('click', applyMinimalArBaselinePreset);
  document
    .getElementById('btn-clear-refpoint-cache')
    ?.addEventListener('click', () => {
      void handleClearRefPointCache();
    });

  // Modal backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideSettingsModal();
    }
  });

  // Populate build version label (one-time, build info is constant)
  const buildLabel = document.getElementById('build-version-label');
  if (buildLabel) {
    try {
      const info = getBuildInfo();
      buildLabel.textContent = `${info.appVersion} (${info.commitHash})`;
    } catch (error) {
      buildLabel.textContent = 'Build unavailable';
      log.warn('Build metadata unavailable for settings modal', error);
    }
  }

  log.debug('Settings modal initialized');
}

// --- Show / Hide ---

/**
 * Show the settings modal.
 * Loads current options and populates form.
 */
export function showSettingsModal(): void {
  if (!modal) {
    log.warn('Settings modal not initialized');
    return;
  }

  // `loadRecordingOptions` always returns a freshly built object (validated, or
  // a clone of the defaults), so it is already this modal's private working
  // copy — no extra clone needed before mutating it in place.
  workingOptions = loadRecordingOptions();

  populateForm(workingOptions);

  modal.classList.remove('hidden');
  log.debug('Settings modal shown');
}

/**
 * Hide the settings modal.
 * Discards any unsaved changes.
 */
export function hideSettingsModal(): void {
  if (!modal) {
    return;
  }

  modal.classList.add('hidden');
  workingOptions = null;
  log.debug('Settings modal hidden');
}

/**
 * Check if the settings modal is currently visible.
 */
export function isSettingsModalVisible(): boolean {
  return modal !== null && !modal.classList.contains('hidden');
}

// --- Actions ---

function handleSave(): void {
  if (!workingOptions) {
    return;
  }

  saveRecordingOptions(workingOptions);
  log.debug('Settings saved:', workingOptions);

  // Notify callback
  if (onOptionsChanged) {
    onOptionsChanged(structuredClone(workingOptions));
  }

  hideSettingsModal();
}

function handleReset(): void {
  workingOptions = resetRecordingOptions();
  populateForm(workingOptions);
  log.debug('Settings reset to defaults');
}

async function handleClearRefPointCache(): Promise<void> {
  if (!onClearRefPointCache) {
    log.warn('Clear ref-point cache requested but no callback is wired');
    return;
  }

  const confirmed = await showConfirmDialog({
    message:
      'Clear cached reference points for all scenarios? They will be re-imported from your *.zip recordings the next time a scenario is opened. Observations not yet exported to a zip will be lost.',
    confirmLabel: 'Clear Cache',
    cancelLabel: 'Cancel',
  });

  if (!confirmed) {
    log.debug('User cancelled clearing ref-point cache');
    return;
  }

  try {
    await onClearRefPointCache();
    log.info('Ref-point cache cleared');
  } catch (err) {
    log.error('Failed to clear ref-point cache:', err);
  }
}

function applyMinimalArBaselinePreset(): void {
  if (!workingOptions) {
    return;
  }

  workingOptions.images.enabled = false;
  workingOptions.depth.enabled = false;
  workingOptions.arCrashIsolation.enableDomOverlay = false;
  workingOptions.arCrashIsolation.enableCameraAccess = false;
  workingOptions.arCrashIsolation.enableDepthSensingFeature = false;
  workingOptions.arCrashIsolation.enableCss3dRenderer = false;
  workingOptions.arCrashIsolation.enableCameraTextureAcquisition = false;

  populateForm(workingOptions);
  log.debug('Applied minimal AR baseline preset');
}

// --- Exported for testing ---

/**
 * Get the current working options (for testing).
 * Returns null if modal is not shown.
 */
export function getWorkingOptions(): RecordingOptions | null {
  return workingOptions ? structuredClone(workingOptions) : null;
}

/**
 * The shape of every table-bound control (for testing) — lets the
 * binding-completeness test assert each bound id (and each slider's
 * `${id}-value` label) exists in the production HTML, so a typo'd id fails CI
 * as a missing element instead of shipping a silently dead control.
 */
export function getOptionBindingIdsForTesting(): readonly {
  id: string;
  kind: 'checkbox' | 'slider' | 'select';
}[] {
  return OPTION_BINDINGS.map(({ id, kind }) => ({ id, kind }));
}
