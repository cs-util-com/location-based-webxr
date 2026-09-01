import { expect } from "@playwright/test";

/**
 * Tier 1 e2e fakes for the persistent-anchor starter.
 *
 * Why this file exists (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §5–§6):
 * Playwright Chromium has no WebXR and no real GPS, so the *application flow*
 * (boot → guidance → soft-gated placement → `?show=` round-trip → copy-link)
 * cannot be exercised against real sensors. Instead of mocking individual
 * browser APIs, the app exposes a DEV-only seam (`window.__anchorStarterSeams`,
 * guarded by `import.meta.env.DEV && !import.meta.env.VITEST` so it is statically
 * stripped from production). This helper installs deterministic fakes over that
 * seam *before* page scripts run (`addInitScript`) and a small control surface
 * (`window.__anchorStarterTest`) the specs drive from `page.evaluate`.
 *
 * Design notes:
 * - The fakes are duck-typed: `createGpsAnchor`/`createAnchorMarker` are faked,
 *   so the fake AR world-group/camera/marker need no real THREE objects.
 * - `selectTrackingQuality` returns a *controllable* `TrackingQualityReport`
 *   (read lazily on every render), letting a spec pin the onboarding phase.
 * - `startGpsWatch`'s callback is stashed so a spec can push a GPS fix on
 *   demand via `pushGps(...)`; the real coordinator inside the app early-returns
 *   (no AR pose), but `main.ts` still records `lastGps` in its wrapper, which is
 *   all the soft-gated placement flow needs.
 */

/**
 * @typedef {object} InstallFakesOptions
 * @property {object} [trackingReport] Initial `TrackingQualityReport` the faked
 *   `selectTrackingQuality` returns. Defaults to an `ok` (ready) report.
 * @property {boolean} [failClipboard] When true, override
 *   `navigator.clipboard.writeText` to reject so the copy-link failure path can
 *   be exercised.
 * @property {boolean} [failOrientationPermission] When true, the faked
 *   `requestDeviceOrientationPermission` rejects so the post-`initAR` boot
 *   rollback (`failStart`) can be exercised end-to-end.
 */

/**
 * Install the DEV seam fakes + test control surface. MUST be called BEFORE
 * `page.goto('/')` — `addInitScript` runs before any page script, so the seam
 * is in place when `main()` first reads `getSeams()`.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 * @param {InstallFakesOptions} [options] Per-test configuration.
 */
export async function installAnchorStarterFakes(page, options = {}) {
  const config = {
    trackingReport: options.trackingReport ?? {
      state: "ok",
      confidence: 1,
      subScores: { coverage: 1, freshness: 1, agreement: 1 },
    },
    failClipboard: options.failClipboard ?? false,
    failOrientationPermission: options.failOrientationPermission ?? false,
  };

  await page.addInitScript((cfg) => {
    /** Mutable control surface the specs drive from `page.evaluate`. */
    const control = {
      /** GPS callback stashed by the faked `startGpsWatch`. */
      gpsCallback: null,
      /** Arguments captured on every `createAnchorMarker` call. */
      markerCalls: [],
      /**
       * `{ gpsPoint, skipBootstrap }` captured on every successful
       * `createGpsAnchor` call. Lets a spec assert the GPS reference (including
       * altitude) the anchor was created with — e.g. that a `?show=` reload
       * re-applies the persisted altitude on the cache-hit (`skipBootstrap`)
       * path. `addInitScript` re-runs per navigation, so this resets on reload.
       */
      anchorCalls: [],
      /**
       * Markers currently attached to the faked AR world group. spawnAnchor
       * adds a marker before creating the GpsAnchor and must remove it again
       * on any failure; specs assert this stays empty after a failed placement
       * (no orphaned mesh left to overlap a retry).
       */
      worldGroupChildren: [],
      /** Current report returned by the faked `selectTrackingQuality`. */
      trackingReport: cfg.trackingReport,
      /**
       * Tracking-wiring observation (regression guard for the
       * "guidance stuck on AR tracking lost" bug). Since the framework's
       * setter fold, the store and the restart callback arrive TOGETHER as
       * `initAR`'s `callbacks.tracking` group; if `main.ts` drops the group
       * (or either field) the per-frame pose flow silently no-ops and the
       * guidance freezes. The fake `initAR` records what arrived so a spec
       * can assert both fields were passed during boot. `addInitScript`
       * re-runs per navigation, so they reset on reload.
       */
      trackingStoreWired: false,
      trackingCallbacksWired: false,
      /** When true, the faked `createGpsAnchor` throws (placement failure). */
      failCreateAnchor: false,
      /**
       * Options captured on every `createWayfindingHud` call (F2 wiring
       * guard): the HUD must be started for the placed anchor (cache-miss)
       * AND for the `?show=` cache-hit anchor, with the camera, a target
       * getter, and the distance deadband. `addInitScript` re-runs per
       * navigation, so this resets on reload.
       */
      wayfindingHudCalls: [],
      /** Counts fake wayfinding-HUD disposals (teardown proof). */
      wayfindingHudDisposals: 0,
      /**
       * Whether the faked hit-test reticle currently reports a surface under
       * the screen centre. Defaults to `true` so the existing placement specs
       * (which don't care about the reticle) keep placing; the no-surface spec
       * flips it to exercise the "point at the ground" gate.
       */
      reticleVisible: true,
      /** Faked reticle world position handed to `getWorldPosition(out)`. */
      reticleWorldPosition: { x: 1, y: 0, z: -2 },
      /** Set true once the faked reticle handle is disposed. */
      reticleDisposed: false,
      /** Whether `requestDeviceOrientationPermission` should reject. */
      failOrientationPermission: cfg.failOrientationPermission,
      /** Counts how many times `endARSession` was called (rollback proof). */
      endARSessionCalls: 0,
      /**
       * Current GPS alignment the faked `selectAlignmentMatrix` returns.
       * Non-null by default (a desktop browser never computes a real one), so
       * the placement gate passes; the no-alignment spec sets it to `null`.
       */
      alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };

    /** Drive a GPS fix through the stashed watch callback. */
    control.pushGps = (fix) => {
      if (!control.gpsCallback) {
        throw new Error("GPS watch not started yet — click Start first");
      }
      control.gpsCallback({
        lat: fix.lat,
        lon: fix.lon,
        altitude: typeof fix.altitude === "number" ? fix.altitude : 0,
        accuracy: typeof fix.accuracy === "number" ? fix.accuracy : 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      });
    };

    window.__anchorStarterTest = control;

    window.__anchorStarterSeams = {
      checkWebXRSupport: () =>
        Promise.resolve({ supported: true, granted: true }),
      checkGeolocationPermission: () =>
        Promise.resolve({ supported: true, granted: true }),
      initAR: (_container, _isolation, _features, callbacks) => {
        // Record the tracking group so the wiring spec can assert the store
        // and the restart callback both rode into initAR (setter-fold API).
        control.trackingStoreWired = Boolean(callbacks?.tracking?.store);
        control.trackingCallbacksWired =
          typeof callbacks?.tracking?.onRestarted === "function";
        // The REAL session-end callback and the REAL store, captured so the
        // teardown spec can end the session the way the system does and
        // assert the store state — a wired-boolean alone cannot prove the
        // callback tears anything down (PR #364 review: only the
        // start-failure path did).
        control.fireSessionEnd = callbacks?.onSessionEnd ?? null;
        control.trackingStore = callbacks?.tracking?.store ?? null;
        return Promise.resolve();
      },
      endARSession: () => {
        control.endARSessionCalls++;
        return Promise.resolve();
      },
      getArWorldGroup: () => ({
        add(child) {
          control.worldGroupChildren.push(child);
        },
        remove(child) {
          const index = control.worldGroupChildren.indexOf(child);
          if (index !== -1) control.worldGroupChildren.splice(index, 1);
        },
        // Stubs for the cache-miss marker positioning (world→local). The fake
        // marker is duck-typed, so an identity worldToLocal is enough.
        updateWorldMatrix() {},
        worldToLocal: (v) => v,
      }),
      getCamera: () => ({}),
      startGpsWatch: (onPosition) => {
        control.gpsCallback = onPosition;
      },
      startOrientationWatch: () => {},
      requestDeviceOrientationPermission: () =>
        control.failOrientationPermission
          ? Promise.reject(
              new Error("forced orientation-permission failure (e2e)"),
            )
          : Promise.resolve(),
      createGpsAnchor: (opts) => {
        if (control.failCreateAnchor) {
          throw new Error("forced anchor failure (e2e)");
        }
        // Record the GPS reference (lat/lon/altitude) + phase the anchor was
        // created with so specs can assert the persisted altitude is re-applied
        // on a `?show=` reload (cache-hit `skipBootstrap` path).
        control.anchorCalls.push({
          gpsPoint: opts?.gpsPoint,
          skipBootstrap: opts?.skipBootstrap === true,
        });
        // Mirror the framework: a cache-miss anchor (no skipBootstrap) commits
        // its bootstrap median and fires onBootstrapComplete. The fake has no
        // real median, so it reports the seed gpsPoint as the committed
        // reference — which is what AnchorStarter persists into `?show=`.
        if (
          opts &&
          !opts.skipBootstrap &&
          typeof opts.onBootstrapComplete === "function"
        ) {
          opts.onBootstrapComplete(opts.gpsPoint);
        }
        return { dispose() {} };
      },
      createWayfindingHud: (opts) => {
        control.wayfindingHudCalls.push({
          hasCamera: Boolean(opts?.camera),
          hasGetTargets: typeof opts?.getTargets === "function",
          distanceMin: opts?.distanceMin,
          distanceMax: opts?.distanceMax,
        });
        return {
          dispose() {
            control.wayfindingHudDisposals++;
          },
        };
      },
      selectTrackingQuality: () => control.trackingReport,
      selectAlignmentMatrix: () => control.alignmentMatrix,
      startReticleHitTest: () => ({
        isVisible: () => control.reticleVisible,
        getWorldPosition: (out) => {
          const p = control.reticleWorldPosition;
          if (out && typeof out.set === "function") {
            out.set(p.x, p.y, p.z);
            return out;
          }
          return p;
        },
        dispose: () => {
          control.reticleDisposed = true;
        },
      }),
      createAnchorMarker: (markerOptions) => {
        control.markerCalls.push(markerOptions ?? {});
        // Duck-typed marker: just enough for the cache-miss positioning
        // (`marker.position.copy(...)`) and the deferred reveal
        // (`marker.visible`).
        return {
          visible: true,
          position: { copy() {} },
          getWorldPosition: (out) => out,
        };
      },
    };

    if (cfg.failClipboard && navigator.clipboard) {
      navigator.clipboard.writeText = () =>
        Promise.reject(new Error("forced clipboard failure (e2e)"));
    }
  }, config);
}

/**
 * Boot the app through the start gesture and wait until the live HUD is
 * revealed (guidance + placement panels visible). Assumes fakes are installed.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 */
export async function bootAnchorStarter(page) {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await expect(page.getByTestId("placement")).toBeVisible();
}

/**
 * Push a single GPS fix into the running app via the test control surface.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 * @param {{ lat: number, lon: number, altitude?: number, accuracy?: number }} fix
 */
export async function pushGpsFix(page, fix) {
  await page.evaluate((value) => {
    window.__anchorStarterTest.pushGps(value);
  }, fix);
}
