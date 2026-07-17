import { defineConfig } from 'tsdown';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Explicit per-file entry list. The package's `exports` field in package.json
// advertises wildcard subpaths (e.g. `./utils/*` -> `./dist/utils/*.js`) for every
// public subdirectory, so tsdown must emit a per-file artifact for each public
// `.ts` source file. See docs:
//   GpsPlusSlamJs_Docs/docs/2026-04-29-recorder-e2e-import-resolution-failure.md
// The list is intentionally explicit (not a glob) so that adding a new public
// subpath is a deliberate PR-visible change. Keep this list in sync with
// package.json `exports` and with `src/`.
const entryFiles = [
  // Root barrel
  'src/index.ts',

  // ar/
  'src/ar/index.ts',
  'src/ar/ar-crash-isolation.ts',
  'src/ar/bresenham3d.ts',
  'src/ar/camera-blit-capture.ts',
  'src/ar/capability-checker.ts',
  'src/ar/capture-failure-tracker.ts',
  // Motion-filter config types + defaults — deep-imported by the recorder's
  // recording-options catalog (G-1 move); the `./ar/*` exports wildcard
  // advertises this subpath, so it must be built per-file.
  'src/ar/capture-motion-gate.ts',
  'src/ar/chromium-camera-access-workaround.ts',
  'src/ar/depth-grid-lookup.ts',
  'src/ar/depth-sampler.ts',
  // Live CPU-depth occluder — deep-importable (`./ar/*` wildcard), consumed by
  // the recorder's live-occlusion wiring, so it must be built per-file.
  'src/ar/depth-occluder.ts',
  'src/ar/depth-unprojection.ts',
  'src/ar/occupancy-grid.ts',
  // Pure voxel→surface mesher — deep-importable (the `./ar/*` wildcard
  // advertises this subpath), so it must be built per-file.
  'src/ar/occupancy-mesher.ts',
  // Occluder Web Worker protocol (runs `meshOccupiedCells` off-thread); the
  // recorder's worker shell deep-imports it, so it must be a dist entry.
  'src/ar/occlusion-mesh-worker.ts',
  'src/ar/enable-gps-ar.ts',
  'src/ar/frame-loop.ts',
  'src/ar/image-capture.ts',
  // Pure blur/blackness metrics + verdict policy — deep-imported by the
  // recorder's image-quality.worker.ts (NOT via the `/ar` barrel). The `./ar/*`
  // exports wildcard advertises this subpath, so it must be built per-file.
  'src/ar/image-quality.ts',
  'src/ar/replay-scene.ts',
  'src/ar/scene-node-names.ts',
  'src/ar/webxr-nue-basis.ts',
  'src/ar/webxr-session.ts',
  'src/ar/xr-camera-texture.ts',
  'src/ar/xr-error-handler.ts',
  'src/ar/xr-frame-loop.ts',

  // ar/qr/ (QR cluster — sub-barrel + per-file entries)
  'src/ar/qr/index.ts',
  // QR detection + derive-on-read + debug viz — deep-imported by the recorder's
  // live-QR modules (NOT via the `/ar` barrel, which eagerly pulls
  // permission-checker into partially-mocked wiring tests). The `./ar/*` exports
  // wildcard matches multi-segment subpaths, so `./ar/qr/<file>` is already
  // advertised and each must be built per-file.
  'src/ar/qr/planar-pnp.ts',
  'src/ar/qr/qr-debug-view.ts',
  'src/ar/qr/qr-derived-pose.ts',
  'src/ar/qr/qr-detection-controller.ts',
  'src/ar/qr/qr-frontend.ts',
  'src/ar/qr/qr-pose.ts',
  'src/ar/qr/qr-size-depth-context.ts',
  'src/ar/qr/qr-size-measurer.ts',

  // core/ (curated re-export of gps-plus-slam-js for app consumers)
  'src/core/index.ts',

  // licensing/
  'src/licensing/index.ts',

  // geo/
  'src/geo/index.ts',
  'src/geo/h3-proximity.ts',

  // sensors/
  'src/sensors/index.ts',
  'src/sensors/gps.ts',
  'src/sensors/gps-error-handler.ts',
  'src/sensors/permission-checker.ts',
  'src/sensors/absolute-orientation.ts',

  // state/
  'src/state/index.ts',
  'src/state/app-selectors.ts',
  'src/state/combined-root-state.ts',
  'src/state/create-slam-app-store.ts',
  'src/state/persistence-middleware.ts',
  'src/state/recording-slice.ts',
  'src/state/tracking-slice.ts',
  'src/state/tracking-quality.ts',
  'src/state/gps-event-coordinator.ts',
  'src/state/gps-ar-pose-sampler.ts',
  // Deep-imported by the recorder's qr-debug-controller (selectDerivedQrPlacement)
  // — same barrel-avoidance rationale as the ar/qr-* entries above.
  'src/state/qr-detected-slice.ts',
  'src/state/recording-replayer.ts',
  'src/state/replay-engine.ts',
  // Desktop-replay composer + its occupancy subscriber (2026-07-15 replay-harness
  // Part A) — deep-imported by consumer apps (PhysicsDemo) via the `./state/*`
  // wildcard, so each must be a per-file dist entry (missing entry breaks Vite
  // resolution at runtime; see 2026-04-29-recorder-e2e-import-resolution doc).
  'src/state/replay-session.ts',
  'src/state/replay-occupancy-subscriber.ts',
  'src/state/store-subscribers.ts',
  'src/state/subscribe-to-selector.ts',

  // storage/
  'src/storage/index.ts',
  'src/storage/file-system-utils.ts',
  'src/storage/null-storage-backend.ts',
  'src/storage/opfs-storage.ts',
  'src/storage/opfs-storage-backend.ts',
  'src/storage/storage-backend.ts',
  'src/storage/zip-export.ts',
  'src/storage/zip-reader.ts',
  'src/storage/zip-coverage-embed.ts',

  // test-utils/ (advertised in `exports`; consumed by RecorderApp tests)
  'src/test-utils/browser-mocks.ts',
  'src/test-utils/zip-round-trip-helpers.ts',

  // types/
  'src/types/index.ts',
  'src/types/ar-types.ts',
  'src/types/geo-types.ts',

  // utils/
  'src/utils/index.ts',
  'src/utils/concurrency.ts',
  'src/utils/failure-tracker.ts',
  'src/utils/format-file-size.ts',
  'src/utils/fused-path.ts',
  'src/utils/list-formatter.ts',
  'src/utils/logger.ts',

  // visualization/
  'src/visualization/index.ts',
  'src/visualization/accuracy-circles.ts',
  'src/visualization/alignment-lerper.ts',
  'src/visualization/ar-world-group-alignment.ts',
  'src/visualization/camera-follower.ts',
  'src/visualization/css3d-renderer-manager.ts',
  'src/visualization/frame-conversions.ts',
  'src/visualization/frustum-visibility.ts',
  'src/visualization/gps-anchor.ts',
  'src/visualization/gps-compass-cubes.ts',
  'src/visualization/gps-event-markers.ts',
  'src/visualization/occlusion-mesh.ts',
  // Instanced debug-cube visualizer of the occupancy grid — promoted from the
  // recorder (2026-07-15 replay-harness Part A) so every consumer gets both
  // mesh styles. Deep-imported by the recorder (main.ts / replay-mode.ts) and
  // the PhysicsDemo via the `./visualization/*` wildcard, so it must be a
  // per-file dist entry (a missing entry breaks Vite resolution at runtime —
  // see 2026-04-29-recorder-e2e-import-resolution-failure.md).
  'src/visualization/occupancy-cubes-visualizer.ts',
  // Main-thread driver for the occluder Web Worker offload — deep-imported by
  // the recorder's worker client, so it must be a dist entry.
  'src/visualization/occluder-mesh-driver.ts',
  'src/visualization/hit-test-reticle.ts',
  'src/visualization/leaflet-map-overlay.ts',
  'src/visualization/lerp-utils.ts',
  'src/visualization/map-data.ts',
  'src/visualization/map-overlay-draw.ts',
  // Engine-free desktop pointer raycast helper (2026-07-15 replay-harness Part B)
  // — deep-imported by consumer apps (PhysicsDemo) via `./visualization/*`.
  'src/visualization/pointer-picking.ts',
  'src/visualization/three-dispose.ts',
  'src/visualization/vis-colors.ts',
];

export default defineConfig({
  entry: entryFiles.map((p) => resolve(projectRoot, p)),
  tsconfig: resolve(projectRoot, 'tsconfig.app.json'),
  format: ['esm'],
  dts: true,
  outDir: resolve(projectRoot, 'dist'),
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: ['three', 'leaflet', 'h3-js', '@zip.js/zip.js', 'vitest'],
  },
});
