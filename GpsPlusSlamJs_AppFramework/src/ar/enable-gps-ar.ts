/**
 * Headless "Enable GPS AR" seam (Decision B3).
 *
 * Composes the framework's existing building blocks — WebXR support check,
 * the individual permission requesters, the GPS/orientation sensor watches and
 * `initAR` — into a single in-gesture orchestration with an observable status,
 * so an app can render its **own** `<button>` over the state instead of
 * inheriting a framework-owned button DOM (unlike three.js' `ARButton`).
 *
 * Why a seam and not a button: per the plan
 * (`2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md` §4 / §6.5),
 * the permission/enter-AR *sequence* is the reusable core; the button DOM, toast
 * surface and copy are app-specific UX and stay app-local.
 *
 * All collaborators are injected (defaulting to the real framework functions),
 * so the orchestration is unit-testable headlessly without WebXR, GPS hardware
 * or a DOM.
 *
 * Permission scope (RECORDED decision): the default path is **minimal** — WebXR
 * support + geolocation + orientation. `requestDepth` is opt-in and is the only
 * thing that triggers `requestWebXRWithDepthPermission`. We deliberately do
 * **not** call `requestAllPermissions()` on the default path because it
 * unconditionally probes depth ("3D map") *and* camera, which the minimal set
 * excludes.
 */

import type { ArCrashIsolationOptions } from './ar-crash-isolation';
import type { GpsPosition, RawDeviceOrientation } from '../sensors/gps';
import {
  requestGeolocationPermission as defaultRequestGeolocationPermission,
  requestOrientationPermission as defaultRequestOrientationPermission,
  requestWebXRWithDepthPermission as defaultRequestWebXRWithDepthPermission,
  type PermissionStatus,
} from '../sensors/permission-checker';
import {
  startGpsWatch as defaultStartGpsWatch,
  startOrientationWatch as defaultStartOrientationWatch,
  stopGpsWatch as defaultStopGpsWatch,
  stopOrientationWatch as defaultStopOrientationWatch,
} from '../sensors/gps';
import {
  initAR as defaultInitAR,
  endARSession as defaultEndARSession,
  isWebXRSupported as defaultIsWebXRSupported,
  type ArSessionCallbacks,
  type SessionFeatureOptions,
} from './webxr-session';
import { createIsolatedRegistry } from '../utils/isolated-registry';
import { createLogger } from '../utils/logger';

const log = createLogger('EnableGpsAr');

/**
 * Lifecycle status of the controller. The app maps these onto its button:
 * - `checking`   — support probe in flight (initial / after `refreshSupport`)
 * - `unsupported`— WebXR immersive-ar is unavailable; button stays disabled
 * - `ready`      — supported and idle; button is the live "Enable GPS AR" CTA
 * - `starting`   — in-gesture orchestration in flight (button shows progress)
 * - `running`    — AR session started; button reflects the durable end state
 * - `stopping`   — teardown in flight (watches stopping, session ending)
 * - `error`      — orchestration failed; button reverts to a retryable CTA
 */
export type EnableGpsArStatus =
  | 'checking'
  | 'unsupported'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

/** Observable controller state. */
export interface EnableGpsArState {
  readonly status: EnableGpsArStatus;
  /** Human-readable failure reason when `status === 'error'`. */
  readonly error?: string;
}

/** Per-`enable()` configuration. */
export interface EnableGpsArConfig {
  /** DOM element hosting the AR canvas / dom-overlay (passed to `initAR`). */
  container: HTMLElement;
  /**
   * Opt-in to the depth ("3D map") permission probe. Default `false` — the
   * minimal default set is WebXR + geolocation + orientation only.
   */
  requestDepth?: boolean;
  /**
   * Forward `requestHitTest` to `initAR` so the session requests the WebXR
   * `hit-test` feature (the minimal AR example needs this for its reticle).
   */
  requestHitTest?: boolean;
  /** Crash-isolation diagnostic flags forwarded verbatim to `initAR`. */
  isolationOptions?: Partial<ArCrashIsolationOptions>;
  /**
   * Per-session AR callbacks (tracking store, depth, image capture, …)
   * forwarded verbatim to `initAR` — see {@link ArSessionCallbacks}.
   */
  callbacks?: ArSessionCallbacks;
  /** Receives every GPS fix from the started watch. */
  onGpsPosition?: (position: GpsPosition) => void;
  /** Receives every device-orientation sample from the started watch. */
  onOrientation?: (orientation: RawDeviceOrientation) => void;
}

/** Result of a single `enable()` attempt. */
export interface EnableGpsArResult {
  readonly ok: boolean;
  /** Failure reason when `ok === false`. */
  readonly error?: string;
}

/** Injectable collaborators (default to the real framework functions). */
export interface EnableGpsArDeps {
  isWebXRSupported: () => Promise<boolean>;
  requestGeolocationPermission: () => Promise<PermissionStatus>;
  requestOrientationPermission: () => Promise<PermissionStatus>;
  requestWebXRWithDepthPermission: () => Promise<PermissionStatus>;
  startGpsWatch: (
    onPosition: (position: GpsPosition) => void,
    onError?: (error: GeolocationPositionError) => void
  ) => void;
  startOrientationWatch: (
    onOrientation: (orientation: RawDeviceOrientation) => void
  ) => void;
  initAR: (
    container: HTMLElement,
    isolationOptions?: Partial<ArCrashIsolationOptions>,
    sessionFeatures?: SessionFeatureOptions,
    callbacks?: ArSessionCallbacks
  ) => Promise<void>;
  stopGpsWatch: () => void;
  stopOrientationWatch: () => void;
  endARSession: () => Promise<void>;
}

/** Public controller surface the app drives from its button. */
export interface EnableGpsArController {
  /** Current observable state (button derives its label/disabled from this). */
  getState: () => EnableGpsArState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe: (listener: (state: EnableGpsArState) => void) => () => void;
  /**
   * Probe WebXR support and move `checking → ready | unsupported`. Call once on
   * boot (and optionally on resume). No-op effect on permissions.
   */
  refreshSupport: () => Promise<void>;
  /**
   * In-gesture orchestration: request the configured permissions, start the
   * sensor watches and `initAR`. Must be called synchronously from a user
   * gesture so the permission prompts are allowed. Idempotent while
   * `starting`/`running`/`stopping`.
   */
  enable: (config: EnableGpsArConfig) => Promise<EnableGpsArResult>;
  /**
   * Tear down the running AR session: stop sensor watches, end the WebXR
   * session, and transition `running → stopping → ready` so the user can
   * re-enter AR. No-op when not `running`.
   */
  disable: () => Promise<void>;
}

const defaultDeps: EnableGpsArDeps = {
  isWebXRSupported: defaultIsWebXRSupported,
  requestGeolocationPermission: defaultRequestGeolocationPermission,
  requestOrientationPermission: defaultRequestOrientationPermission,
  requestWebXRWithDepthPermission: defaultRequestWebXRWithDepthPermission,
  startGpsWatch: defaultStartGpsWatch,
  startOrientationWatch: defaultStartOrientationWatch,
  initAR: defaultInitAR,
  stopGpsWatch: defaultStopGpsWatch,
  stopOrientationWatch: defaultStopOrientationWatch,
  endARSession: defaultEndARSession,
};

/**
 * Create an "Enable GPS AR" controller. Pass partial `deps` in tests to inject
 * fakes; production callers use the defaults.
 */
export function createEnableGpsArController(
  deps: Partial<EnableGpsArDeps> = {}
): EnableGpsArController {
  const resolved: EnableGpsArDeps = { ...defaultDeps, ...deps };

  let state: EnableGpsArState = { status: 'checking' };
  const listeners = createIsolatedRegistry<[EnableGpsArState]>({
    onError: (err) =>
      log.error('State listener threw; continuing dispatch:', err),
  });
  let gpsWatchActive = false;
  let orientationWatchActive = false;

  function setState(next: EnableGpsArState): void {
    state = next;
    // Snapshotted so a listener that (un)subscribes during dispatch cannot
    // mutate the set mid-iteration, and each listener isolated so one throwing
    // subscriber cannot abort the dispatch and destabilize the
    // refreshSupport()/enable() transitions that drive it. Both come from the
    // shared registry rather than being re-derived here.
    listeners.run(state);
  }

  async function refreshSupport(): Promise<void> {
    // Never clobber an active session. refreshSupport() may be called on
    // resume/visibility-change while enable() is mid-orchestration (`starting`)
    // or a session already runs (`running`). Re-probing WebXR support is moot
    // then, and entering `checking` here would revert the button to a
    // "not started" CTA. This pre-probe guard is what actually protects those
    // states: the post-probe guard below only covers a *concurrent* enable()
    // that advances the status *during* the probe — by then we have already
    // overwritten any pre-existing active status, so it cannot restore it.
    if (
      state.status === 'starting' ||
      state.status === 'running' ||
      state.status === 'stopping'
    )
      return;
    setState({ status: 'checking' });
    const supported = await probeSupport();
    // Guard the async gap: a concurrent enable() (which is not blocked from the
    // `checking` state) can advance the status while the probe is in flight.
    // Only the `checking` state we set above is ours to replace; otherwise this
    // stale probe result would clobber an active starting/running state and
    // wrongly revert the button to a "not started" CTA.
    if (state.status !== 'checking') return;
    setState({ status: supported ? 'ready' : 'unsupported' });
  }

  async function probeSupport(): Promise<boolean> {
    try {
      return await resolved.isWebXRSupported();
    } catch {
      // A throwing probe (e.g. a broken navigator.xr shim) is treated as
      // "unsupported" rather than crashing the controller.
      return false;
    }
  }

  /**
   * Request the configured permissions. Returns an error message when a
   * *blocking* permission (geolocation, or depth when opted in) is not granted,
   * or `null` on success. Orientation is best-effort and never blocks.
   */
  async function requestPermissions(
    config: EnableGpsArConfig
  ): Promise<string | null> {
    const geolocation = await resolved.requestGeolocationPermission();
    if (geolocation.granted !== true) {
      return geolocation.error ?? 'Location permission is required for GPS AR.';
    }

    // Orientation is recommended, not blocking: many Android devices grant it
    // implicitly, and a denial should not stop AR (the compass simply degrades).
    // We still request it so iOS shows its prompt inside the gesture. A
    // *rejecting* probe (broken shim / future impl that throws) must degrade
    // just like a denial — never bubble to enable()'s catch and fail the
    // session — so we swallow the rejection here.
    try {
      await resolved.requestOrientationPermission();
    } catch {
      // Best-effort: orientation never blocks AR startup.
    }

    if (config.requestDepth) {
      const depth = await resolved.requestWebXRWithDepthPermission();
      if (depth.granted !== true) {
        return depth.error ?? 'Depth (3D map) permission was denied.';
      }
    }

    return null;
  }

  async function enable(config: EnableGpsArConfig): Promise<EnableGpsArResult> {
    if (
      state.status === 'starting' ||
      state.status === 'running' ||
      state.status === 'stopping'
    ) {
      return {
        ok: false,
        error: 'AR is already starting, running or stopping.',
      };
    }

    setState({ status: 'starting' });

    // Wrap the app's per-session callbacks so the controller OBSERVES the
    // session ending (system back gesture, or an external endARSession call).
    // While `running` it stops the watches and returns to `ready`, so the
    // app's button recovers without a page reload and the watches cannot
    // leak. In every other status the respective path already owns the
    // teardown (the enable() rollback below during `starting`, disable()
    // during `stopping`) and the wrapper stays inert. The app's own
    // onSessionEnd is always chained, whatever the status.
    const appCallbacks = config.callbacks;
    const callbacks: ArSessionCallbacks = {
      ...appCallbacks,
      onSessionEnd: (info) => {
        if (state.status === 'running') {
          stopWatches();
          setState({ status: 'ready' });
        }
        appCallbacks?.onSessionEnd?.(info);
      },
    };

    let sessionStarted = false;
    try {
      const permissionError = await requestPermissions(config);
      if (permissionError !== null) {
        return fail(permissionError);
      }

      // --- AR session ---
      // Start sensor watches only AFTER a successful initAR. The controller
      // exposes no watch teardown, so starting them before initAR would leak
      // active watches if initAR rejects — and the retry from the `error` state
      // would start duplicates. Gating the start calls behind the resolved
      // initAR keeps watcher count bounded to one set per running session.
      await resolved.initAR(
        config.container,
        config.isolationOptions,
        {
          requestHitTest: config.requestHitTest,
        },
        callbacks
      );
      sessionStarted = true;

      // --- Sensor watches ---
      if (config.onGpsPosition) {
        resolved.startGpsWatch(config.onGpsPosition);
        gpsWatchActive = true;
      }
      if (config.onOrientation) {
        resolved.startOrientationWatch(config.onOrientation);
        orientationWatchActive = true;
      }

      setState({ status: 'running' });
      return { ok: true };
    } catch (err) {
      // If initAR already started the XR session, a *later* failure (a sensor
      // watch start throwing) must roll back the session and any watch already
      // started — disable() only runs from 'running', and a retry from 'error'
      // re-enters enable() without cleaning up, so without this the session and
      // watch leak and accumulate. A pre-initAR failure leaves nothing to undo.
      if (sessionStarted) {
        // Each cleanup step is isolated: a throw in one (e.g. stopGpsWatch) must
        // not bypass the others — most importantly endARSession, whose skip would
        // strand the WebXR session and leak the renderer. Errors are logged, not
        // rethrown, so every step always runs.
        if (gpsWatchActive) {
          try {
            resolved.stopGpsWatch();
          } catch (cleanupErr) {
            log.error(
              'stopGpsWatch during enable() cleanup threw:',
              cleanupErr
            );
          }
          gpsWatchActive = false;
        }
        if (orientationWatchActive) {
          try {
            resolved.stopOrientationWatch();
          } catch (cleanupErr) {
            log.error(
              'stopOrientationWatch during enable() cleanup threw:',
              cleanupErr
            );
          }
          orientationWatchActive = false;
        }
        try {
          await resolved.endARSession();
        } catch (cleanupErr) {
          log.error(
            'Cleanup after enable() failure threw; continuing:',
            cleanupErr
          );
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(message);
    }
  }

  function fail(error: string): EnableGpsArResult {
    setState({ status: 'error', error });
    return { ok: false, error };
  }

  /** Stop whichever sensor watches this controller started (idempotent). */
  function stopWatches(): void {
    if (gpsWatchActive) {
      resolved.stopGpsWatch();
      gpsWatchActive = false;
    }
    if (orientationWatchActive) {
      resolved.stopOrientationWatch();
      orientationWatchActive = false;
    }
  }

  async function disable(): Promise<void> {
    if (state.status !== 'running') return;
    setState({ status: 'stopping' });

    stopWatches();

    try {
      await resolved.endARSession();
    } catch (err) {
      log.error('endARSession threw during disable; continuing teardown:', err);
    }

    setState({ status: 'ready' });
  }

  return {
    getState: () => state,
    subscribe: (listener) => listeners.register(listener),
    refreshSupport,
    enable,
    disable,
  };
}
