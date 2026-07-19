/**
 * Settings Modal - UI for configuring recording options.
 *
 * Provides a modal dialog for users to toggle and configure
 * depth sampling and image capture settings.
 */

import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
  cloneRecordingOptions,
  DEPTH_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  MOTION_FILTER_CONSTRAINTS,
  QUALITY_FILTER_CONSTRAINTS,
  OCCUPANCY_CONSTRAINTS,
  FRAME_TILE_DISPLAY_CONSTRAINTS,
  QR_CONSTRAINTS,
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

const log = createLogger('SettingsModal');

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

// --- State ---

/** Current working copy of options (not saved until user clicks Save) */
let workingOptions: RecordingOptions | null = null;

/** Callback to notify when options are saved */
let onOptionsChanged: ((options: RecordingOptions) => void) | null = null;

/** Callback to clear the reference-point cache across all scenarios */
let onClearRefPointCache: (() => void | Promise<void>) | null = null;

// --- DOM Elements ---

let modal: HTMLElement | null = null;
let depthEnabledCheckbox: HTMLInputElement | null = null;
let depthIntervalSlider: HTMLInputElement | null = null;
let depthIntervalValue: HTMLElement | null = null;
let depthGridSlider: HTMLInputElement | null = null;
let depthGridValue: HTMLElement | null = null;
let depthRgbCheckbox: HTMLInputElement | null = null;
let imagesEnabledCheckbox: HTMLInputElement | null = null;
let imagesIntervalSlider: HTMLInputElement | null = null;
let imagesIntervalValue: HTMLElement | null = null;
let imagesQualitySlider: HTMLInputElement | null = null;
let imagesQualityValue: HTMLElement | null = null;
let imagesResolutionDivisorSlider: HTMLInputElement | null = null;
let imagesResolutionDivisorValue: HTMLElement | null = null;
let imagesMotionFilterCheckbox: HTMLInputElement | null = null;
let imagesQualityFilterCheckbox: HTMLInputElement | null = null;
let imagesBlurMetricSelect: HTMLSelectElement | null = null;
let imagesBlurThresholdSlider: HTMLInputElement | null = null;
let imagesBlurThresholdValue: HTMLElement | null = null;
let imagesMinLuminanceSlider: HTMLInputElement | null = null;
let imagesMinLuminanceValue: HTMLElement | null = null;
let imagesMaxAngularSlider: HTMLInputElement | null = null;
let imagesMaxAngularValue: HTMLElement | null = null;
let imagesMaxLinearSlider: HTMLInputElement | null = null;
let imagesMaxLinearValue: HTMLElement | null = null;
let arDomOverlayEnabledCheckbox: HTMLInputElement | null = null;
let arCameraAccessEnabledCheckbox: HTMLInputElement | null = null;
let arDepthSensingEnabledCheckbox: HTMLInputElement | null = null;
let arCss3dEnabledCheckbox: HTMLInputElement | null = null;
let arCameraTextureEnabledCheckbox: HTMLInputElement | null = null;
let arChromiumProjectionLayerWorkaroundCheckbox: HTMLInputElement | null = null;
let occupancyCellSizeSlider: HTMLInputElement | null = null;
let occupancyCellSizeValue: HTMLElement | null = null;
let occupancyMinConfidenceSlider: HTMLInputElement | null = null;
let occupancyMinConfidenceValue: HTMLElement | null = null;
let occupancyLiveOcclusionCheckbox: HTMLInputElement | null = null;
let occupancyPersistentOcclusionCheckbox: HTMLInputElement | null = null;
let occupancyOccluderDebugStyleSelect: HTMLSelectElement | null = null;
let occupancyOccluderMeshModeSelect: HTMLSelectElement | null = null;
let occupancyOccluderRadiusSlider: HTMLInputElement | null = null;
let occupancyOccluderRadiusValue: HTMLElement | null = null;
let frameTileDisplayDivisorSlider: HTMLInputElement | null = null;
let frameTileDisplayDivisorValue: HTMLElement | null = null;
let frameTileMaxTilesSlider: HTMLInputElement | null = null;
let frameTileMaxTilesValue: HTMLElement | null = null;
let vizFrameTilesCheckbox: HTMLInputElement | null = null;
let vizOccupancyCubesCheckbox: HTMLInputElement | null = null;
let vizGpsAlignmentMarkersCheckbox: HTMLInputElement | null = null;
let vizCompassCubesCheckbox: HTMLInputElement | null = null;
let vizHeadingUpMapCheckbox: HTMLInputElement | null = null;
let vizStatsOverlayCheckbox: HTMLInputElement | null = null;
let compassColdStartOverrideCheckbox: HTMLInputElement | null = null;
let compassRotationPriorCheckbox: HTMLInputElement | null = null;
let compassWebXRConsistencyCheckbox: HTMLInputElement | null = null;
let compassExperimentCheckbox: HTMLInputElement | null = null;
let compassRobustSolverComparisonCheckbox: HTMLInputElement | null = null;
let loopClosureDetectorCheckbox: HTMLInputElement | null = null;
let qrEnabledCheckbox: HTMLInputElement | null = null;
let qrIntervalSlider: HTMLInputElement | null = null;
let qrIntervalValue: HTMLElement | null = null;
let qrCaptureSizeSlider: HTMLInputElement | null = null;
let qrCaptureSizeValue: HTMLElement | null = null;

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

  // Get modal elements
  modal = document.getElementById('settings-modal');
  if (!modal) {
    log.warn('Settings modal element not found in DOM');
    return;
  }

  // Get button elements
  const btnSettings = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-settings-close');
  const btnSave = document.getElementById('btn-settings-save');
  const btnReset = document.getElementById('btn-settings-reset');
  const btnMinimalBaseline = document.getElementById('btn-ar-minimal-baseline');
  const btnClearRefPointCache = document.getElementById(
    'btn-clear-refpoint-cache'
  );

  // Get form elements
  depthEnabledCheckbox = document.getElementById(
    'depth-enabled'
  ) as HTMLInputElement;
  depthIntervalSlider = document.getElementById(
    'depth-interval'
  ) as HTMLInputElement;
  depthIntervalValue = document.getElementById('depth-interval-value');
  depthGridSlider = document.getElementById('depth-grid') as HTMLInputElement;
  depthGridValue = document.getElementById('depth-grid-value');
  depthRgbCheckbox = document.getElementById('depth-rgb') as HTMLInputElement;

  imagesEnabledCheckbox = document.getElementById(
    'images-enabled'
  ) as HTMLInputElement;
  imagesIntervalSlider = document.getElementById(
    'images-interval'
  ) as HTMLInputElement;
  imagesIntervalValue = document.getElementById('images-interval-value');
  imagesQualitySlider = document.getElementById(
    'images-quality'
  ) as HTMLInputElement;
  imagesQualityValue = document.getElementById('images-quality-value');
  imagesResolutionDivisorSlider = document.getElementById(
    'images-resolution-divisor'
  ) as HTMLInputElement;
  imagesResolutionDivisorValue = document.getElementById(
    'images-resolution-divisor-value'
  );
  imagesMotionFilterCheckbox = document.getElementById(
    'images-motion-filter'
  ) as HTMLInputElement;
  imagesQualityFilterCheckbox = document.getElementById(
    'images-quality-filter'
  ) as HTMLInputElement;
  imagesBlurMetricSelect = document.getElementById(
    'images-blur-metric'
  ) as HTMLSelectElement;
  imagesBlurThresholdSlider = document.getElementById(
    'images-blur-threshold'
  ) as HTMLInputElement;
  imagesBlurThresholdValue = document.getElementById(
    'images-blur-threshold-value'
  );
  imagesMinLuminanceSlider = document.getElementById(
    'images-min-luminance'
  ) as HTMLInputElement;
  imagesMinLuminanceValue = document.getElementById(
    'images-min-luminance-value'
  );
  imagesMaxAngularSlider = document.getElementById(
    'images-max-angular'
  ) as HTMLInputElement;
  imagesMaxAngularValue = document.getElementById('images-max-angular-value');
  imagesMaxLinearSlider = document.getElementById(
    'images-max-linear'
  ) as HTMLInputElement;
  imagesMaxLinearValue = document.getElementById('images-max-linear-value');
  arDomOverlayEnabledCheckbox = document.getElementById(
    'ar-dom-overlay-enabled'
  ) as HTMLInputElement;
  arCameraAccessEnabledCheckbox = document.getElementById(
    'ar-camera-access-enabled'
  ) as HTMLInputElement;
  arDepthSensingEnabledCheckbox = document.getElementById(
    'ar-depth-sensing-enabled'
  ) as HTMLInputElement;
  arCss3dEnabledCheckbox = document.getElementById(
    'ar-css3d-enabled'
  ) as HTMLInputElement;
  arCameraTextureEnabledCheckbox = document.getElementById(
    'ar-camera-texture-enabled'
  ) as HTMLInputElement;
  arChromiumProjectionLayerWorkaroundCheckbox = document.getElementById(
    'ar-chromium-projection-layer-workaround'
  ) as HTMLInputElement;
  occupancyCellSizeSlider = document.getElementById(
    'occupancy-cell-size'
  ) as HTMLInputElement;
  occupancyCellSizeValue = document.getElementById('occupancy-cell-size-value');
  occupancyMinConfidenceSlider = document.getElementById(
    'occupancy-min-confidence'
  ) as HTMLInputElement;
  occupancyLiveOcclusionCheckbox = document.getElementById(
    'occupancy-live-occlusion'
  ) as HTMLInputElement;
  occupancyPersistentOcclusionCheckbox = document.getElementById(
    'occupancy-persistent-occlusion'
  ) as HTMLInputElement;
  occupancyOccluderDebugStyleSelect = document.getElementById(
    'occupancy-occluder-debug-style'
  ) as HTMLSelectElement;
  occupancyOccluderMeshModeSelect = document.getElementById(
    'occupancy-occluder-mesh-mode'
  ) as HTMLSelectElement;
  occupancyOccluderRadiusSlider = document.getElementById(
    'occupancy-occluder-radius'
  ) as HTMLInputElement;
  occupancyOccluderRadiusValue = document.getElementById(
    'occupancy-occluder-radius-value'
  );
  occupancyMinConfidenceValue = document.getElementById(
    'occupancy-min-confidence-value'
  );
  frameTileMaxTilesSlider = document.getElementById(
    'frame-tile-max-tiles'
  ) as HTMLInputElement;
  frameTileMaxTilesValue = document.getElementById(
    'frame-tile-max-tiles-value'
  );
  frameTileDisplayDivisorSlider = document.getElementById(
    'frame-tile-display-divisor'
  ) as HTMLInputElement;
  frameTileDisplayDivisorValue = document.getElementById(
    'frame-tile-display-divisor-value'
  );
  vizFrameTilesCheckbox = document.getElementById(
    'viz-frame-tiles'
  ) as HTMLInputElement;
  vizOccupancyCubesCheckbox = document.getElementById(
    'viz-occupancy-cubes'
  ) as HTMLInputElement;
  vizGpsAlignmentMarkersCheckbox = document.getElementById(
    'viz-gps-alignment-markers'
  ) as HTMLInputElement;
  vizCompassCubesCheckbox = document.getElementById(
    'viz-compass-cubes'
  ) as HTMLInputElement;
  vizHeadingUpMapCheckbox = document.getElementById(
    'viz-heading-up-map'
  ) as HTMLInputElement;
  vizStatsOverlayCheckbox = document.getElementById(
    'viz-stats-overlay'
  ) as HTMLInputElement;
  compassColdStartOverrideCheckbox = document.getElementById(
    'compass-cold-start-override'
  ) as HTMLInputElement;
  compassRotationPriorCheckbox = document.getElementById(
    'compass-rotation-prior'
  ) as HTMLInputElement;
  compassWebXRConsistencyCheckbox = document.getElementById(
    'compass-webxr-consistency'
  ) as HTMLInputElement;
  compassExperimentCheckbox = document.getElementById(
    'compass-experiment'
  ) as HTMLInputElement;
  compassRobustSolverComparisonCheckbox = document.getElementById(
    'compass-robust-solver-comparison'
  ) as HTMLInputElement;
  loopClosureDetectorCheckbox = document.getElementById(
    'loop-closure-detector'
  ) as HTMLInputElement;
  qrEnabledCheckbox = document.getElementById('qr-enabled') as HTMLInputElement;
  qrIntervalSlider = document.getElementById('qr-interval') as HTMLInputElement;
  qrIntervalValue = document.getElementById('qr-interval-value');
  qrCaptureSizeSlider = document.getElementById(
    'qr-capture-size'
  ) as HTMLInputElement;
  qrCaptureSizeValue = document.getElementById('qr-capture-size-value');

  // Wire up events
  btnSettings?.addEventListener('click', showSettingsModal);
  btnClose?.addEventListener('click', hideSettingsModal);
  btnSave?.addEventListener('click', handleSave);
  btnReset?.addEventListener('click', handleReset);
  btnMinimalBaseline?.addEventListener('click', applyMinimalArBaselinePreset);
  btnClearRefPointCache?.addEventListener('click', () => {
    void handleClearRefPointCache();
  });

  // Modal backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideSettingsModal();
    }
  });

  // Slider change handlers
  depthIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && depthIntervalSlider && depthIntervalValue) {
      const value = parseInt(depthIntervalSlider.value, 10);
      workingOptions.depth.intervalMs = value;
      depthIntervalValue.textContent = `${(value / 1000).toFixed(1)}s`;
    }
  });

  depthGridSlider?.addEventListener('input', () => {
    if (workingOptions && depthGridSlider && depthGridValue) {
      const value = parseInt(depthGridSlider.value, 10);
      workingOptions.depth.gridSize = value;
      depthGridValue.textContent = `${value}×${value}`;
    }
  });

  imagesIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && imagesIntervalSlider && imagesIntervalValue) {
      const value = parseInt(imagesIntervalSlider.value, 10);
      workingOptions.images.intervalMs = value;
      imagesIntervalValue.textContent = formatImageInterval(value);
    }
  });

  imagesQualitySlider?.addEventListener('input', () => {
    if (workingOptions && imagesQualitySlider && imagesQualityValue) {
      const value = parseFloat(imagesQualitySlider.value);
      workingOptions.images.quality = value;
      imagesQualityValue.textContent = `${Math.round(value * 100)}%`;
    }
  });

  imagesResolutionDivisorSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      imagesResolutionDivisorSlider &&
      imagesResolutionDivisorValue
    ) {
      const value = parseInt(imagesResolutionDivisorSlider.value, 10);
      workingOptions.images.resolutionDivisor = value;
      imagesResolutionDivisorValue.textContent = formatResolutionDivisor(value);
    }
  });

  // Motion-gate thresholds: stored in rad/s and m/s (the units the gate
  // compares against), so the slider value IS the stored value.
  imagesMaxAngularSlider?.addEventListener('input', () => {
    if (workingOptions && imagesMaxAngularSlider && imagesMaxAngularValue) {
      const value = parseFloat(imagesMaxAngularSlider.value);
      workingOptions.images.motionFilter.maxAngularVelocity = value;
      imagesMaxAngularValue.textContent = formatAngularVelocity(value);
    }
  });

  imagesMaxLinearSlider?.addEventListener('input', () => {
    if (workingOptions && imagesMaxLinearSlider && imagesMaxLinearValue) {
      const value = parseFloat(imagesMaxLinearSlider.value);
      workingOptions.images.motionFilter.maxLinearVelocity = value;
      imagesMaxLinearValue.textContent = `${value.toFixed(2)} m/s`;
    }
  });

  // Voxel size slider operates in centimetres for readability; the stored
  // option (`occupancy.cellSizeM`) is in metres, so divide by 100 on the way in.
  occupancyCellSizeSlider?.addEventListener('input', () => {
    if (workingOptions && occupancyCellSizeSlider && occupancyCellSizeValue) {
      const cm = parseInt(occupancyCellSizeSlider.value, 10);
      workingOptions.occupancy.cellSizeM = cm / 100;
      occupancyCellSizeValue.textContent = `${cm} cm`;
    }
  });

  // Live CPU-depth occluder (occupancy.liveOcclusion). Live-AR only; applies on
  // the next Enter-AR. Composes with the persistent mesh below (both can be on).
  occupancyLiveOcclusionCheckbox?.addEventListener('change', () => {
    if (workingOptions && occupancyLiveOcclusionCheckbox) {
      workingOptions.occupancy.liveOcclusion =
        occupancyLiveOcclusionCheckbox.checked;
    }
  });

  // Persistent depth-only occlusion mesh (occupancy.persistentOcclusion).
  // Applies on the next Enter-AR / replay load, like the voxel-size knobs.
  occupancyPersistentOcclusionCheckbox?.addEventListener('change', () => {
    if (workingOptions && occupancyPersistentOcclusionCheckbox) {
      workingOptions.occupancy.persistentOcclusion =
        occupancyPersistentOcclusionCheckbox.checked;
    }
  });

  // Debug-visualization style of the persistent occluder mesh
  // (occupancy.occluderDebugStyle): off / matcap / depth-shaded / wireframe /
  // both. Only visible when the persistent occluder is on. Validated on save
  // (unknown <option> values resolve to 'off'). Applies on the next Enter-AR /
  // replay load.
  occupancyOccluderDebugStyleSelect?.addEventListener('change', () => {
    if (workingOptions && occupancyOccluderDebugStyleSelect) {
      workingOptions.occupancy.occluderDebugStyle =
        occupancyOccluderDebugStyleSelect.value as OccluderDebugStyle;
    }
  });

  // Persistent-occluder mesher style (occupancy.occluderMeshMode): blocky cubes
  // vs corner-fit cubes vs surface nets, so the surface-hugging meshers can be
  // A/B-tested on-device. Validated on save; only one of OCCLUDER_MESH_MODES is
  // accepted, so an unexpected <option> value still resolves to the default.
  // Applies on the next Enter-AR / replay load.
  occupancyOccluderMeshModeSelect?.addEventListener('change', () => {
    if (workingOptions && occupancyOccluderMeshModeSelect) {
      workingOptions.occupancy.occluderMeshMode =
        occupancyOccluderMeshModeSelect.value as OccluderMeshMode;
    }
  });

  // Camera-local occluder window (Step 2, 2026-07-03 long-session fps plan);
  // 0 = unlimited. Applies on the next Enter-AR / replay load.
  occupancyOccluderRadiusSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      occupancyOccluderRadiusSlider &&
      occupancyOccluderRadiusValue
    ) {
      const value = parseInt(occupancyOccluderRadiusSlider.value, 10);
      workingOptions.occupancy.occluderRadiusM = value;
      occupancyOccluderRadiusValue.textContent = formatOccluderRadius(value);
    }
  });

  // Voxel noise filter: minimum observations before a cell is rendered.
  // Integer count (occupancy.minConfidence); 1 = unfiltered.
  occupancyMinConfidenceSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      occupancyMinConfidenceSlider &&
      occupancyMinConfidenceValue
    ) {
      const n = parseInt(occupancyMinConfidenceSlider.value, 10);
      workingOptions.occupancy.minConfidence = n;
      occupancyMinConfidenceValue.textContent =
        n === 1 ? '1 (unfiltered)' : String(n);
    }
  });

  // Frame-tile DISPLAY resolution (D7-resolution) — distinct from the capture
  // images.resolutionDivisor above; this only downscales the in-AR/replay tile
  // texture to save GPU memory. Reuses the same ÷N label formatter.
  frameTileDisplayDivisorSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      frameTileDisplayDivisorSlider &&
      frameTileDisplayDivisorValue
    ) {
      const value = parseInt(frameTileDisplayDivisorSlider.value, 10);
      workingOptions.frameTileDisplay.divisor = value;
      frameTileDisplayDivisorValue.textContent = formatResolutionDivisor(value);
    }
  });

  // Live frame-tile FIFO cap (Step 4, 2026-07-03 long-session fps plan).
  // Live-only: replay never applies it (full-path coverage auditing).
  frameTileMaxTilesSlider?.addEventListener('input', () => {
    if (workingOptions && frameTileMaxTilesSlider && frameTileMaxTilesValue) {
      const value = parseInt(frameTileMaxTilesSlider.value, 10);
      workingOptions.frameTileDisplay.maxTiles = value;
      frameTileMaxTilesValue.textContent = formatMaxTiles(value);
    }
  });

  // Checkbox change handlers
  depthEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && depthEnabledCheckbox) {
      workingOptions.depth.enabled = depthEnabledCheckbox.checked;
      updateDepthControlsState();
    }
  });

  depthRgbCheckbox?.addEventListener('change', () => {
    if (workingOptions && depthRgbCheckbox) {
      workingOptions.depth.rgb = depthRgbCheckbox.checked;
    }
  });

  imagesEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && imagesEnabledCheckbox) {
      workingOptions.images.enabled = imagesEnabledCheckbox.checked;
      updateImageControlsState();
    }
  });

  imagesMotionFilterCheckbox?.addEventListener('change', () => {
    if (workingOptions && imagesMotionFilterCheckbox) {
      workingOptions.images.motionFilter.enabled =
        imagesMotionFilterCheckbox.checked;
      // The threshold sliders only matter while the gate is on.
      updateImageControlsState();
    }
  });

  imagesQualityFilterCheckbox?.addEventListener('change', () => {
    if (workingOptions && imagesQualityFilterCheckbox) {
      workingOptions.images.qualityFilter.enabled =
        imagesQualityFilterCheckbox.checked;
      // The threshold sliders only matter while the gate is on.
      updateImageControlsState();
    }
  });

  // Image-quality thresholds: stored exactly as the slider value (a 0–1 fraction
  // for blur, a 0–255 luma cutoff for blackness), so no unit conversion.
  imagesBlurThresholdSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      imagesBlurThresholdSlider &&
      imagesBlurThresholdValue
    ) {
      const value = parseFloat(imagesBlurThresholdSlider.value);
      workingOptions.images.qualityFilter.blurRelativeThreshold = value;
      imagesBlurThresholdValue.textContent = formatBlurThreshold(value);
    }
  });

  imagesMinLuminanceSlider?.addEventListener('input', () => {
    if (workingOptions && imagesMinLuminanceSlider && imagesMinLuminanceValue) {
      const value = parseFloat(imagesMinLuminanceSlider.value);
      workingOptions.images.qualityFilter.minMeanLuminance = value;
      imagesMinLuminanceValue.textContent = formatMinLuminance(value);
    }
  });

  imagesBlurMetricSelect?.addEventListener('change', () => {
    if (workingOptions && imagesBlurMetricSelect) {
      // Membership-check rather than trusting the DOM value — save-time
      // validation would catch it too, but never let an invalid id sit in
      // the working copy.
      const value = imagesBlurMetricSelect.value as BlurMetricId;
      workingOptions.images.qualityFilter.blurMetric = BLUR_METRIC_IDS.includes(
        value
      )
        ? value
        : 'variance-of-laplacian';
    }
  });

  arDomOverlayEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arDomOverlayEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableDomOverlay =
        arDomOverlayEnabledCheckbox.checked;
    }
  });

  arCameraAccessEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCameraAccessEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCameraAccess =
        arCameraAccessEnabledCheckbox.checked;
    }
  });

  arDepthSensingEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arDepthSensingEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableDepthSensingFeature =
        arDepthSensingEnabledCheckbox.checked;
    }
  });

  arCss3dEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCss3dEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCss3dRenderer =
        arCss3dEnabledCheckbox.checked;
    }
  });

  arCameraTextureEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCameraTextureEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCameraTextureAcquisition =
        arCameraTextureEnabledCheckbox.checked;
    }
  });

  arChromiumProjectionLayerWorkaroundCheckbox?.addEventListener(
    'change',
    () => {
      if (workingOptions && arChromiumProjectionLayerWorkaroundCheckbox) {
        workingOptions.arCrashIsolation.applyChromiumProjectionLayerWorkaround =
          arChromiumProjectionLayerWorkaroundCheckbox.checked;
      }
    }
  );

  // Live debug-overlay toggles (Finding B). Each gates only what is drawn live
  // during recording; replay is unaffected. Read once at the next Enter-AR.
  vizFrameTilesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizFrameTilesCheckbox) {
      workingOptions.visualization.frameTiles = vizFrameTilesCheckbox.checked;
    }
  });

  vizOccupancyCubesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizOccupancyCubesCheckbox) {
      workingOptions.visualization.occupancyCubes =
        vizOccupancyCubesCheckbox.checked;
    }
  });

  vizGpsAlignmentMarkersCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizGpsAlignmentMarkersCheckbox) {
      workingOptions.visualization.gpsAlignmentMarkers =
        vizGpsAlignmentMarkersCheckbox.checked;
    }
  });

  vizCompassCubesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizCompassCubesCheckbox) {
      workingOptions.visualization.compassCubes =
        vizCompassCubesCheckbox.checked;
    }
  });

  vizHeadingUpMapCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizHeadingUpMapCheckbox) {
      workingOptions.visualization.headingUpMap =
        vizHeadingUpMapCheckbox.checked;
    }
  });

  vizStatsOverlayCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizStatsOverlayCheckbox) {
      workingOptions.visualization.statsOverlay =
        vizStatsOverlayCheckbox.checked;
    }
  });

  // Compass alignment debug toggles (Phase-4). Feed the absolute-orientation
  // compass into the live GPS alignment; applied on the next session/reload.
  compassColdStartOverrideCheckbox?.addEventListener('change', () => {
    if (workingOptions && compassColdStartOverrideCheckbox) {
      workingOptions.compassDebug.coldStartOverride =
        compassColdStartOverrideCheckbox.checked;
    }
  });

  compassRotationPriorCheckbox?.addEventListener('change', () => {
    if (workingOptions && compassRotationPriorCheckbox) {
      workingOptions.compassDebug.rotationPrior =
        compassRotationPriorCheckbox.checked;
    }
  });

  compassWebXRConsistencyCheckbox?.addEventListener('change', () => {
    if (workingOptions && compassWebXRConsistencyCheckbox) {
      workingOptions.compassDebug.webXRConsistency =
        compassWebXRConsistencyCheckbox.checked;
    }
  });

  // 2026-07-19 field-test toggles (enablement plan): experiment combo + the
  // alternative robust-solver comparison arm. Applied on the next session/reload like the
  // other compass flags.
  compassExperimentCheckbox?.addEventListener('change', () => {
    if (workingOptions && compassExperimentCheckbox) {
      workingOptions.compassDebug.experiment =
        compassExperimentCheckbox.checked;
    }
  });

  compassRobustSolverComparisonCheckbox?.addEventListener('change', () => {
    if (workingOptions && compassRobustSolverComparisonCheckbox) {
      workingOptions.compassDebug.robustSolverComparison =
        compassRobustSolverComparisonCheckbox.checked;
    }
  });

  // Loop-closure capture (experimental, default OFF). Applied on the next
  // session — the detector wiring is read once at Enter AR.
  loopClosureDetectorCheckbox?.addEventListener('change', () => {
    if (workingOptions && loopClosureDetectorCheckbox) {
      workingOptions.loopClosureDebug.detectorEnabled =
        loopClosureDetectorCheckbox.checked;
    }
  });

  // QR detection (recorder live-QR WS-2/WS-5). Opt-in; the interval + capture
  // sliders are gated on the enabled checkbox (mirrors depth/images).
  qrEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && qrEnabledCheckbox) {
      workingOptions.qr.enabled = qrEnabledCheckbox.checked;
      updateQrControlsState();
    }
  });

  qrIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && qrIntervalSlider && qrIntervalValue) {
      const value = parseInt(qrIntervalSlider.value, 10);
      workingOptions.qr.intervalMs = value;
      qrIntervalValue.textContent = `${value} ms`;
    }
  });

  qrCaptureSizeSlider?.addEventListener('input', () => {
    if (workingOptions && qrCaptureSizeSlider && qrCaptureSizeValue) {
      const value = parseInt(qrCaptureSizeSlider.value, 10);
      workingOptions.qr.captureSize = value;
      qrCaptureSizeValue.textContent = `${value} px`;
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
 * Format the resolution divisor value for display.
 * 1 → "1× (full)", 2 → "÷2 (half)", 4 → "÷4 (quarter)", etc.
 */
/** Label for the live frame-tile cap: 0 is the explicit "unlimited". */
function formatMaxTiles(maxTiles: number): string {
  return maxTiles === 0 ? 'unlimited' : String(maxTiles);
}

/** Label for the occluder window: 0 is the explicit "unlimited". */
function formatOccluderRadius(radiusM: number): string {
  return radiusM === 0 ? 'unlimited' : `${radiusM} m`;
}

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
 * Show the settings modal.
 * Loads current options and populates form.
 */
export function showSettingsModal(): void {
  if (!modal) {
    log.warn('Settings modal not initialized');
    return;
  }

  // Load current options and create working copy
  workingOptions = cloneRecordingOptions(loadRecordingOptions());

  // Populate form with current values
  populateForm(workingOptions);

  // Show modal
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

// --- Form Population ---

function populateForm(options: RecordingOptions): void {
  // Depth options
  if (depthEnabledCheckbox) {
    depthEnabledCheckbox.checked = options.depth.enabled;
  }
  if (depthIntervalSlider) {
    depthIntervalSlider.min = String(DEPTH_CONSTRAINTS.intervalMs.min);
    depthIntervalSlider.max = String(DEPTH_CONSTRAINTS.intervalMs.max);
    depthIntervalSlider.step = String(DEPTH_CONSTRAINTS.intervalMs.step);
    depthIntervalSlider.value = String(options.depth.intervalMs);
  }
  if (depthIntervalValue) {
    depthIntervalValue.textContent = `${(options.depth.intervalMs / 1000).toFixed(1)}s`;
  }
  if (depthGridSlider) {
    depthGridSlider.min = String(DEPTH_CONSTRAINTS.gridSize.min);
    depthGridSlider.max = String(DEPTH_CONSTRAINTS.gridSize.max);
    depthGridSlider.step = String(DEPTH_CONSTRAINTS.gridSize.step);
    depthGridSlider.value = String(options.depth.gridSize);
  }
  if (depthGridValue) {
    depthGridValue.textContent = `${options.depth.gridSize}×${options.depth.gridSize}`;
  }
  if (depthRgbCheckbox) {
    depthRgbCheckbox.checked = options.depth.rgb;
  }

  // Image options
  if (imagesEnabledCheckbox) {
    imagesEnabledCheckbox.checked = options.images.enabled;
  }
  if (imagesMotionFilterCheckbox) {
    imagesMotionFilterCheckbox.checked = options.images.motionFilter.enabled;
  }
  if (imagesQualityFilterCheckbox) {
    imagesQualityFilterCheckbox.checked = options.images.qualityFilter.enabled;
  }
  if (imagesIntervalSlider) {
    imagesIntervalSlider.min = String(IMAGE_CONSTRAINTS.intervalMs.min);
    imagesIntervalSlider.max = String(IMAGE_CONSTRAINTS.intervalMs.max);
    imagesIntervalSlider.step = String(IMAGE_CONSTRAINTS.intervalMs.step);
    imagesIntervalSlider.value = String(options.images.intervalMs);
  }
  if (imagesIntervalValue) {
    imagesIntervalValue.textContent = formatImageInterval(
      options.images.intervalMs
    );
  }
  if (imagesQualitySlider) {
    imagesQualitySlider.min = String(IMAGE_CONSTRAINTS.quality.min);
    imagesQualitySlider.max = String(IMAGE_CONSTRAINTS.quality.max);
    imagesQualitySlider.step = String(IMAGE_CONSTRAINTS.quality.step);
    imagesQualitySlider.value = String(options.images.quality);
  }
  if (imagesQualityValue) {
    imagesQualityValue.textContent = `${Math.round(options.images.quality * 100)}%`;
  }
  if (imagesResolutionDivisorSlider) {
    imagesResolutionDivisorSlider.min = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.min
    );
    imagesResolutionDivisorSlider.max = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.max
    );
    imagesResolutionDivisorSlider.step = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.step
    );
    imagesResolutionDivisorSlider.value = String(
      options.images.resolutionDivisor
    );
  }
  if (imagesResolutionDivisorValue) {
    imagesResolutionDivisorValue.textContent = formatResolutionDivisor(
      options.images.resolutionDivisor
    );
  }
  if (imagesMaxAngularSlider) {
    imagesMaxAngularSlider.min = String(
      MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.min
    );
    imagesMaxAngularSlider.max = String(
      MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.max
    );
    imagesMaxAngularSlider.step = String(
      MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.step
    );
    imagesMaxAngularSlider.value = String(
      options.images.motionFilter.maxAngularVelocity
    );
  }
  if (imagesMaxAngularValue) {
    imagesMaxAngularValue.textContent = formatAngularVelocity(
      options.images.motionFilter.maxAngularVelocity
    );
  }
  if (imagesMaxLinearSlider) {
    imagesMaxLinearSlider.min = String(
      MOTION_FILTER_CONSTRAINTS.maxLinearVelocity.min
    );
    imagesMaxLinearSlider.max = String(
      MOTION_FILTER_CONSTRAINTS.maxLinearVelocity.max
    );
    imagesMaxLinearSlider.step = String(
      MOTION_FILTER_CONSTRAINTS.maxLinearVelocity.step
    );
    imagesMaxLinearSlider.value = String(
      options.images.motionFilter.maxLinearVelocity
    );
  }
  if (imagesMaxLinearValue) {
    imagesMaxLinearValue.textContent = `${options.images.motionFilter.maxLinearVelocity.toFixed(
      2
    )} m/s`;
  }
  if (imagesBlurThresholdSlider) {
    imagesBlurThresholdSlider.min = String(
      QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.min
    );
    imagesBlurThresholdSlider.max = String(
      QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.max
    );
    imagesBlurThresholdSlider.step = String(
      QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.step
    );
    imagesBlurThresholdSlider.value = String(
      options.images.qualityFilter.blurRelativeThreshold
    );
  }
  if (imagesBlurThresholdValue) {
    imagesBlurThresholdValue.textContent = formatBlurThreshold(
      options.images.qualityFilter.blurRelativeThreshold
    );
  }
  if (imagesMinLuminanceSlider) {
    imagesMinLuminanceSlider.min = String(
      QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.min
    );
    imagesMinLuminanceSlider.max = String(
      QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.max
    );
    imagesMinLuminanceSlider.step = String(
      QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.step
    );
    imagesMinLuminanceSlider.value = String(
      options.images.qualityFilter.minMeanLuminance
    );
  }
  if (imagesMinLuminanceValue) {
    imagesMinLuminanceValue.textContent = formatMinLuminance(
      options.images.qualityFilter.minMeanLuminance
    );
  }
  if (imagesBlurMetricSelect) {
    // Persisted pre-toggle options may lack blurMetric — render the default.
    imagesBlurMetricSelect.value =
      options.images.qualityFilter.blurMetric ?? 'variance-of-laplacian';
  }

  if (arDomOverlayEnabledCheckbox) {
    arDomOverlayEnabledCheckbox.checked =
      options.arCrashIsolation.enableDomOverlay;
  }
  if (arCameraAccessEnabledCheckbox) {
    arCameraAccessEnabledCheckbox.checked =
      options.arCrashIsolation.enableCameraAccess;
  }
  if (arDepthSensingEnabledCheckbox) {
    arDepthSensingEnabledCheckbox.checked =
      options.arCrashIsolation.enableDepthSensingFeature;
  }
  if (arCss3dEnabledCheckbox) {
    arCss3dEnabledCheckbox.checked =
      options.arCrashIsolation.enableCss3dRenderer;
  }
  if (arCameraTextureEnabledCheckbox) {
    arCameraTextureEnabledCheckbox.checked =
      options.arCrashIsolation.enableCameraTextureAcquisition;
  }
  if (arChromiumProjectionLayerWorkaroundCheckbox) {
    arChromiumProjectionLayerWorkaroundCheckbox.checked =
      options.arCrashIsolation.applyChromiumProjectionLayerWorkaround;
  }

  // Occupancy voxel size — slider min/max/step are in cm (constraints are in m).
  if (occupancyCellSizeSlider) {
    occupancyCellSizeSlider.min = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.min * 100
    );
    occupancyCellSizeSlider.max = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.max * 100
    );
    occupancyCellSizeSlider.step = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.step * 100
    );
    occupancyCellSizeSlider.value = String(
      Math.round(options.occupancy.cellSizeM * 100)
    );
  }
  if (occupancyCellSizeValue) {
    occupancyCellSizeValue.textContent = `${Math.round(options.occupancy.cellSizeM * 100)} cm`;
  }

  // Occupancy noise filter — integer observation count (no unit conversion).
  if (occupancyMinConfidenceSlider) {
    occupancyMinConfidenceSlider.min = String(
      OCCUPANCY_CONSTRAINTS.minConfidence.min
    );
    occupancyMinConfidenceSlider.max = String(
      OCCUPANCY_CONSTRAINTS.minConfidence.max
    );
    occupancyMinConfidenceSlider.step = String(
      OCCUPANCY_CONSTRAINTS.minConfidence.step
    );
    occupancyMinConfidenceSlider.value = String(
      options.occupancy.minConfidence
    );
  }
  if (occupancyMinConfidenceValue) {
    const n = options.occupancy.minConfidence;
    occupancyMinConfidenceValue.textContent =
      n === 1 ? '1 (unfiltered)' : String(n);
  }
  if (occupancyLiveOcclusionCheckbox) {
    occupancyLiveOcclusionCheckbox.checked = options.occupancy.liveOcclusion;
  }
  if (occupancyPersistentOcclusionCheckbox) {
    occupancyPersistentOcclusionCheckbox.checked =
      options.occupancy.persistentOcclusion;
  }
  if (occupancyOccluderDebugStyleSelect) {
    occupancyOccluderDebugStyleSelect.value =
      options.occupancy.occluderDebugStyle;
  }
  if (occupancyOccluderMeshModeSelect) {
    occupancyOccluderMeshModeSelect.value = options.occupancy.occluderMeshMode;
  }
  // Camera-local occluder window (Step 2, 2026-07-03 fps plan)
  if (occupancyOccluderRadiusSlider) {
    occupancyOccluderRadiusSlider.min = String(
      OCCUPANCY_CONSTRAINTS.occluderRadiusM.min
    );
    occupancyOccluderRadiusSlider.max = String(
      OCCUPANCY_CONSTRAINTS.occluderRadiusM.max
    );
    occupancyOccluderRadiusSlider.step = String(
      OCCUPANCY_CONSTRAINTS.occluderRadiusM.step
    );
    occupancyOccluderRadiusSlider.value = String(
      options.occupancy.occluderRadiusM
    );
  }
  if (occupancyOccluderRadiusValue) {
    occupancyOccluderRadiusValue.textContent = formatOccluderRadius(
      options.occupancy.occluderRadiusM
    );
  }

  // Frame-tile display-resolution divisor (D7-resolution)
  if (frameTileDisplayDivisorSlider) {
    frameTileDisplayDivisorSlider.min = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.min
    );
    frameTileDisplayDivisorSlider.max = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.max
    );
    frameTileDisplayDivisorSlider.step = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.step
    );
    frameTileDisplayDivisorSlider.value = String(
      options.frameTileDisplay.divisor
    );
  }
  if (frameTileDisplayDivisorValue) {
    frameTileDisplayDivisorValue.textContent = formatResolutionDivisor(
      options.frameTileDisplay.divisor
    );
  }
  // Live frame-tile FIFO cap (Step 4, 2026-07-03 fps plan)
  if (frameTileMaxTilesSlider) {
    frameTileMaxTilesSlider.min = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.min
    );
    frameTileMaxTilesSlider.max = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.max
    );
    frameTileMaxTilesSlider.step = String(
      FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.step
    );
    frameTileMaxTilesSlider.value = String(options.frameTileDisplay.maxTiles);
  }
  if (frameTileMaxTilesValue) {
    frameTileMaxTilesValue.textContent = formatMaxTiles(
      options.frameTileDisplay.maxTiles
    );
  }

  // Live debug-overlay toggles (Finding B)
  if (vizFrameTilesCheckbox) {
    vizFrameTilesCheckbox.checked = options.visualization.frameTiles;
  }
  if (vizOccupancyCubesCheckbox) {
    vizOccupancyCubesCheckbox.checked = options.visualization.occupancyCubes;
  }
  if (vizGpsAlignmentMarkersCheckbox) {
    vizGpsAlignmentMarkersCheckbox.checked =
      options.visualization.gpsAlignmentMarkers;
  }
  if (vizCompassCubesCheckbox) {
    vizCompassCubesCheckbox.checked = options.visualization.compassCubes;
  }
  if (vizHeadingUpMapCheckbox) {
    vizHeadingUpMapCheckbox.checked = options.visualization.headingUpMap;
  }
  if (vizStatsOverlayCheckbox) {
    vizStatsOverlayCheckbox.checked = options.visualization.statsOverlay;
  }

  // Compass alignment debug toggles (Phase-4)
  if (compassColdStartOverrideCheckbox) {
    compassColdStartOverrideCheckbox.checked =
      options.compassDebug.coldStartOverride;
  }
  if (compassRotationPriorCheckbox) {
    compassRotationPriorCheckbox.checked = options.compassDebug.rotationPrior;
  }
  if (compassWebXRConsistencyCheckbox) {
    compassWebXRConsistencyCheckbox.checked =
      options.compassDebug.webXRConsistency;
  }
  if (compassExperimentCheckbox) {
    compassExperimentCheckbox.checked = options.compassDebug.experiment;
  }
  if (compassRobustSolverComparisonCheckbox) {
    compassRobustSolverComparisonCheckbox.checked =
      options.compassDebug.robustSolverComparison;
  }
  if (loopClosureDetectorCheckbox) {
    loopClosureDetectorCheckbox.checked =
      options.loopClosureDebug.detectorEnabled;
  }

  // QR detection (opt-in). Interval slider in ms, capture-size slider in px.
  if (qrEnabledCheckbox) {
    qrEnabledCheckbox.checked = options.qr.enabled;
  }
  if (qrIntervalSlider) {
    qrIntervalSlider.min = String(QR_CONSTRAINTS.intervalMs.min);
    qrIntervalSlider.max = String(QR_CONSTRAINTS.intervalMs.max);
    qrIntervalSlider.step = String(QR_CONSTRAINTS.intervalMs.step);
    qrIntervalSlider.value = String(options.qr.intervalMs);
  }
  if (qrIntervalValue) {
    qrIntervalValue.textContent = `${options.qr.intervalMs} ms`;
  }
  if (qrCaptureSizeSlider) {
    qrCaptureSizeSlider.min = String(QR_CONSTRAINTS.captureSize.min);
    qrCaptureSizeSlider.max = String(QR_CONSTRAINTS.captureSize.max);
    qrCaptureSizeSlider.step = String(QR_CONSTRAINTS.captureSize.step);
    qrCaptureSizeSlider.value = String(options.qr.captureSize);
  }
  if (qrCaptureSizeValue) {
    qrCaptureSizeValue.textContent = `${options.qr.captureSize} px`;
  }

  // Update enabled/disabled state of controls
  updateDepthControlsState();
  updateImageControlsState();
  updateQrControlsState();
}

function updateDepthControlsState(): void {
  const enabled = depthEnabledCheckbox?.checked ?? true;
  if (depthIntervalSlider) {
    depthIntervalSlider.disabled = !enabled;
  }
  if (depthGridSlider) {
    depthGridSlider.disabled = !enabled;
  }
  if (depthRgbCheckbox) {
    depthRgbCheckbox.disabled = !enabled;
  }
}

function updateImageControlsState(): void {
  const enabled = imagesEnabledCheckbox?.checked ?? true;
  if (imagesIntervalSlider) {
    imagesIntervalSlider.disabled = !enabled;
  }
  if (imagesQualitySlider) {
    imagesQualitySlider.disabled = !enabled;
  }
  if (imagesResolutionDivisorSlider) {
    imagesResolutionDivisorSlider.disabled = !enabled;
  }
  if (imagesMotionFilterCheckbox) {
    // The motion gate only applies to captured images, so it is meaningless
    // when capture is off — disable it alongside the other image sub-controls.
    imagesMotionFilterCheckbox.disabled = !enabled;
  }
  if (imagesQualityFilterCheckbox) {
    // Same rationale as the motion gate — the image-quality gate only acts on
    // captured frames, so it is disabled when capture is off.
    imagesQualityFilterCheckbox.disabled = !enabled;
  }
  // The motion threshold sliders require BOTH capture and the motion gate on.
  const motionEnabled =
    enabled && (imagesMotionFilterCheckbox?.checked ?? true);
  if (imagesMaxAngularSlider) {
    imagesMaxAngularSlider.disabled = !motionEnabled;
  }
  if (imagesMaxLinearSlider) {
    imagesMaxLinearSlider.disabled = !motionEnabled;
  }
  // The quality threshold sliders (and the metric select) require BOTH
  // capture and the quality gate on.
  const qualityEnabled =
    enabled && (imagesQualityFilterCheckbox?.checked ?? false);
  if (imagesBlurThresholdSlider) {
    imagesBlurThresholdSlider.disabled = !qualityEnabled;
  }
  if (imagesMinLuminanceSlider) {
    imagesMinLuminanceSlider.disabled = !qualityEnabled;
  }
  if (imagesBlurMetricSelect) {
    imagesBlurMetricSelect.disabled = !qualityEnabled;
  }
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

function updateQrControlsState(): void {
  // QR is opt-in (default off), so the sliders start disabled until enabled.
  const enabled = qrEnabledCheckbox?.checked ?? false;
  if (qrIntervalSlider) {
    qrIntervalSlider.disabled = !enabled;
  }
  if (qrCaptureSizeSlider) {
    qrCaptureSizeSlider.disabled = !enabled;
  }
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
    onOptionsChanged(cloneRecordingOptions(workingOptions));
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
  return workingOptions ? cloneRecordingOptions(workingOptions) : null;
}
