/**
 * Permission Checker Module
 *
 * Provides utilities to check and verify mandatory device permissions
 * required for AR+GPS tracking: WebXR (immersive-ar), Camera, and Geolocation.
 *
 * This module is used by the setup modal to verify permissions BEFORE
 * the user enters AR mode, providing clear feedback on what's missing.
 */

import { createLogger } from '../utils/logger';
import { probeImmersiveArSupportOutcome } from '../ar/webxr-support-probe';

const log = createLogger('PermissionChecker');

/**
 * Individual permission status for a single capability.
 */
export interface PermissionStatus {
  /** Whether the permission/feature is supported by the browser/device */
  supported: boolean;
  /** Whether permission has been granted (null if not yet requested) */
  granted: boolean | null;
  /** Human-readable error message if not supported or denied */
  error?: string;
}

/**
 * Aggregated status of all mandatory permissions.
 */
export interface PermissionCheckResult {
  /** WebXR immersive-ar session support */
  webxr: PermissionStatus;
  /** Geolocation API access */
  geolocation: PermissionStatus;
  /** Camera access (via getUserMedia) */
  camera: PermissionStatus;
  /** Device orientation (compass) - optional but recommended */
  orientation: PermissionStatus;
  /** File system access for saving recordings */
  fileSystem: PermissionStatus;
  /** Whether all mandatory permissions are ready */
  allMandatoryReady: boolean;
}

// ============================================================================
// File System Permission State
// ============================================================================

/**
 * Internal state for file system permission tracking.
 * This tracks whether a folder has been selected and write access verified.
 */
interface FileSystemState {
  folderSelected: boolean;
  writeVerified: boolean;
  writeError?: string;
}

let fileSystemState: FileSystemState = {
  folderSelected: false,
  writeVerified: false,
};

/**
 * Reset file system permission state.
 * Exported for testing purposes.
 * @internal
 */
export function resetFileSystemState(): void {
  fileSystemState = {
    folderSelected: false,
    writeVerified: false,
  };
}

/**
 * Set file system permission state.
 * Used by the storage module after folder selection and write verification.
 * @internal
 */
export function setFileSystemState(state: Partial<FileSystemState>): void {
  fileSystemState = { ...fileSystemState, ...state };
}

/**
 * Check file system access permission status.
 *
 * User Feedback Issue #1: File system access is critical for recording.
 * This function checks:
 * 1. If OPFS (Origin Private File System) is available
 * 2. If storage has been initialized
 * 3. If write access has been verified
 *
 * Note: We now use OPFS instead of showDirectoryPicker because it works
 * consistently on Android Chrome, iOS Safari, and Desktop browsers.
 *
 * @returns Permission status for file system access
 */
export function checkFileSystemPermission(): PermissionStatus {
  // Check for OPFS support (navigator.storage.getDirectory)
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    return {
      supported: false,
      granted: null,
      error:
        'Origin Private File System (OPFS) not supported. Use Chrome 86+, Safari 15.2+, or Firefox 111+.',
    };
  }

  // API is supported but storage not initialized yet
  if (!fileSystemState.folderSelected) {
    return {
      supported: true,
      granted: null,
    };
  }

  // Storage initialized but write verification failed
  if (!fileSystemState.writeVerified) {
    return {
      supported: true,
      granted: false,
      error:
        fileSystemState.writeError || 'Storage write failed. Please try again.',
    };
  }

  // Storage initialized and write verified
  return {
    supported: true,
    granted: true,
  };
}

/**
 * Check if WebXR immersive-ar mode is supported.
 * Does not request a session, only checks support.
 */
export async function checkWebXRSupport(): Promise<PermissionStatus> {
  if (!navigator.xr) {
    return {
      supported: false,
      granted: null,
      error:
        'WebXR API not available. Use a compatible browser like Chrome on Android.',
    };
  }

  // Timeout-guarded probe (2026-07-24): a wedged OS XR runtime can make
  // isSessionSupported('immersive-ar') never settle, and this check sits on
  // every consumer's boot path — an unanswered probe must degrade to
  // "not supported" (→ replay/desktop fallback UX), never hang the app.
  const outcome = await probeImmersiveArSupportOutcome();
  switch (outcome) {
    case 'supported':
      // WebXR doesn't have a separate permission - support implies availability
      return { supported: true, granted: true };
    case 'unsupported':
      return {
        supported: false,
        granted: null,
        error: 'AR mode not supported. Ensure you have ARCore/ARKit installed.',
      };
    default:
      // 'error' and 'timeout': the answer is unknown, not a confirmed
      // missing-ARCore — keep the transient "try again" framing.
      return {
        supported: false,
        granted: null,
        error: 'Failed to check AR support. Please refresh and try again.',
      };
  }
}

/**
 * Shared Permissions-API status checker (quality-review C-2): probe-free
 * query with the standard supported/granted/denied/prompt mapping. The two
 * former copies (geolocation/camera) differed only in the API guard and the
 * user-facing strings.
 */
async function checkPermissionViaQuery(options: {
  readonly name: PermissionName;
  /** Result of the feature-specific API-availability guard. */
  readonly apiAvailable: boolean;
  readonly unsupportedError: string;
  readonly deniedError: string;
}): Promise<PermissionStatus> {
  if (!options.apiAvailable) {
    return {
      supported: false,
      granted: null,
      error: options.unsupportedError,
    };
  }

  // Try Permissions API first (doesn't trigger prompt)
  if (navigator.permissions) {
    try {
      const result = await navigator.permissions.query({ name: options.name });
      if (result.state === 'granted') {
        return { supported: true, granted: true };
      } else if (result.state === 'denied') {
        return { supported: true, granted: false, error: options.deniedError };
      }
      // 'prompt' state - permission not yet requested
      return { supported: true, granted: null };
    } catch {
      // Permissions API query failed, continue to the unknown fallback
    }
  }

  // Fallback: the feature is supported but we don't know permission state
  return { supported: true, granted: null };
}

/**
 * Check geolocation permission status without triggering a prompt.
 * Uses the Permissions API if available, otherwise returns unknown state.
 */
export async function checkGeolocationPermission(): Promise<PermissionStatus> {
  return checkPermissionViaQuery({
    name: 'geolocation',
    apiAvailable: !!navigator.geolocation,
    unsupportedError: 'Geolocation API not available in this browser.',
    deniedError: 'Location access denied. Please enable in browser settings.',
  });
}

/**
 * Request geolocation permission by triggering a position request.
 * This will show the browser's permission prompt if not already granted.
 *
 * @param timeoutMs - Maximum time to wait for position (default 10s)
 * @returns Updated permission status after request
 */
export async function requestGeolocationPermission(
  timeoutMs = 10000
): Promise<PermissionStatus> {
  if (!navigator.geolocation) {
    return {
      supported: false,
      granted: null,
      error: 'Geolocation API not available in this browser.',
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => {
        log.info('Geolocation permission granted');
        resolve({ supported: true, granted: true });
      },
      (error) => {
        log.warn('Geolocation error:', error.message);
        if (error.code === error.PERMISSION_DENIED) {
          resolve({
            supported: true,
            granted: false,
            error: 'Location access denied. Please enable in browser settings.',
          });
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          resolve({
            supported: true,
            granted: null,
            error: 'Location unavailable. Check GPS is enabled on your device.',
          });
        } else {
          resolve({
            supported: true,
            granted: null,
            error: 'Location request timed out. Please try again.',
          });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Check camera permission status without triggering a prompt.
 * Uses the Permissions API if available.
 */
export async function checkCameraPermission(): Promise<PermissionStatus> {
  return checkPermissionViaQuery({
    name: 'camera',
    apiAvailable: !!navigator.mediaDevices?.getUserMedia,
    unsupportedError:
      'Camera API not available. Use HTTPS and a modern browser.',
    deniedError: 'Camera access denied. Please enable in browser settings.',
  });
}

/**
 * Request camera permission by triggering getUserMedia.
 * This will show the browser's permission prompt if not already granted.
 *
 * @returns Updated permission status after request
 */
export async function requestCameraPermission(): Promise<PermissionStatus> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      supported: false,
      granted: null,
      error: 'Camera API not available. Use HTTPS and a modern browser.',
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Stop all tracks immediately - we just needed to trigger the permission
    for (const track of stream.getTracks()) {
      track.stop();
    }
    log.info('Camera permission granted');
    return { supported: true, granted: true };
  } catch (err) {
    log.warn('Camera permission error:', err);
    const error = err as DOMException;
    if (error.name === 'NotAllowedError') {
      return {
        supported: true,
        granted: false,
        error: 'Camera access denied. Please enable in browser settings.',
      };
    } else if (error.name === 'NotFoundError') {
      return {
        supported: false,
        granted: null,
        error: 'No camera found on this device.',
      };
    }
    return {
      supported: true,
      granted: null,
      error: 'Camera access failed. Please try again.',
    };
  }
}

/**
 * DeviceOrientationEvent availability + iOS 13+ permission-API probe
 * (quality-review C-2 — this preamble used to be duplicated between the
 * check and request paths). `available: false` ⇒ no orientation support at
 * all; `requestPermission: null` ⇒ orientation works without a permission.
 * The returned function is bound to `DeviceOrientationEvent` (it is a static
 * method — an unbound call would lose `this`).
 */
function getIosOrientationPermissionApi():
  | { available: false }
  | { available: true; requestPermission: (() => Promise<string>) | null } {
  if (typeof DeviceOrientationEvent === 'undefined') {
    return { available: false };
  }
  const withPermission = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  return {
    available: true,
    requestPermission:
      typeof withPermission.requestPermission === 'function'
        ? withPermission.requestPermission.bind(DeviceOrientationEvent)
        : null,
  };
}

/**
 * Check device orientation permission status.
 * On iOS 13+, this requires explicit permission request.
 */
export function checkOrientationPermission(): Promise<PermissionStatus> {
  const api = getIosOrientationPermissionApi();
  if (!api.available) {
    return Promise.resolve({
      supported: false,
      granted: null,
      error: 'Device orientation not supported.',
    });
  }
  if (api.requestPermission) {
    // iOS 13+ - permission API exists but we can't check without prompting
    return Promise.resolve({ supported: true, granted: null });
  }
  // Non-iOS or older iOS - orientation is available without permission
  return Promise.resolve({ supported: true, granted: true });
}

/**
 * Request device orientation permission (iOS 13+).
 * On other platforms, this is a no-op that returns granted.
 */
export async function requestOrientationPermission(): Promise<PermissionStatus> {
  const api = getIosOrientationPermissionApi();
  if (!api.available) {
    return {
      supported: false,
      granted: null,
      error: 'Device orientation not supported.',
    };
  }

  if (api.requestPermission) {
    try {
      const permission = await api.requestPermission();
      if (permission === 'granted') {
        log.info('Orientation permission granted');
        return { supported: true, granted: true };
      } else {
        return {
          supported: true,
          granted: false,
          error: 'Motion & orientation access denied.',
        };
      }
    } catch {
      return {
        supported: true,
        granted: null,
        error: 'Orientation permission request failed.',
      };
    }
  }

  // Non-iOS - orientation is available without permission
  return { supported: true, granted: true };
}

/**
 * Check all permissions without triggering any prompts.
 * Returns current known state of each permission.
 */
export async function checkAllPermissions(): Promise<PermissionCheckResult> {
  const [webxr, geolocation, camera, orientation] = await Promise.all([
    checkWebXRSupport(),
    checkGeolocationPermission(),
    checkCameraPermission(),
    checkOrientationPermission(),
  ]);

  // File system check is synchronous (just checks state)
  const fileSystem = checkFileSystemPermission();

  return {
    webxr,
    geolocation,
    camera,
    orientation,
    fileSystem,
    allMandatoryReady: computeAllMandatoryReady({
      webxr,
      geolocation,
      camera,
      fileSystem,
    }),
  };
}

/**
 * The mandatory-set gate, written once (quality-review C-2 — the 8-clause
 * boolean used to be spelled out twice and could drift): WebXR, Geolocation,
 * Camera and FileSystem must all be supported AND granted. Orientation is
 * deliberately not part of the mandatory set.
 */
function computeAllMandatoryReady(
  result: Pick<
    PermissionCheckResult,
    'webxr' | 'geolocation' | 'camera' | 'fileSystem'
  >
): boolean {
  return [
    result.webxr,
    result.geolocation,
    result.camera,
    result.fileSystem,
  ].every((p) => p.supported && p.granted === true);
}

/**
 * Subscription handle returned by {@link subscribePermissionChanges}.
 * Calling `unsubscribe()` detaches every listener wired by the subscription.
 */
export interface PermissionSubscription {
  unsubscribe(): void;
}

/**
 * Subscribe to out-of-band permission changes.
 *
 * Today the recorder app only re-runs `checkAllPermissions()` at startup
 * and after the user clicks "Grant Permissions" — so a permission flipped
 * via browser settings (e.g. user denies location, then enables it under
 * "site settings") is only detected after a full page reload.
 *
 * This subscription wires three signals:
 * 1. `navigator.permissions.query(...)` returns a live `PermissionStatus`
 *    for `'geolocation'` and `'camera'`; we keep those references and
 *    attach a `'change'` listener via `addEventListener` so we react
 *    immediately when the browser updates the underlying state.
 * 2. `document.visibilitychange` (only when `visibilityState === 'visible'`)
 *    covers the "user tabbed out to settings, toggled, tabbed back" case
 *    on browsers where the `'change'` event does not fire reliably.
 * 3. `window.focus` covers the same scenario for browsers/standalone
 *    windows where `visibilitychange` is not dispatched on focus return.
 *
 * Each signal triggers a fresh {@link checkAllPermissions} call; the
 * resulting {@link PermissionCheckResult} is passed to `callback`.
 *
 * No periodic polling is performed — the trio above is the complete
 * fallback chain. If a browser supports none of these signals for a given
 * permission, the user can still re-check by clicking the (now permanently
 * visible) "Grant Permissions" button.
 *
 * @param callback - Invoked with the latest {@link PermissionCheckResult}
 *   each time one of the signals fires. The initial state is **not**
 *   delivered; callers are expected to have already rendered it.
 * @returns A handle whose `unsubscribe()` removes every wired listener.
 */
export function subscribePermissionChanges(
  callback: (result: PermissionCheckResult) => void
): PermissionSubscription {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  const notify = (): void => {
    if (disposed) return;
    checkAllPermissions()
      .then((result) => {
        if (!disposed) callback(result);
      })
      .catch((err) => {
        log.warn('subscribePermissionChanges: re-check failed', err);
      });
  };

  // Signal 1: PermissionStatus 'change' event for geolocation + camera.
  // navigator.permissions is unavailable on some browsers (Safari < 16
  // for camera, etc.); we tolerate failures silently and fall back to
  // signals 2 + 3.
  if (
    typeof navigator !== 'undefined' &&
    navigator.permissions &&
    typeof navigator.permissions.query === 'function'
  ) {
    const wireStatus = (name: 'geolocation' | 'camera'): void => {
      try {
        navigator.permissions.query({ name }).then(
          (status) => {
            if (disposed) return;
            // `PermissionStatus` extends `EventTarget`, so `addEventListener`
            // is always available wherever `navigator.permissions.query`
            // resolves. We deliberately do NOT fall back to the legacy
            // `onchange` property: monkey-patching it is unsafe when multiple
            // subscriptions coexist (later subscribers overwrite earlier
            // handlers, and restoring the captured `prev` on unsubscribe can
            // clobber another live subscriber's handler).
            const handler = (): void => notify();
            status.addEventListener('change', handler);
            cleanups.push(() => status.removeEventListener('change', handler));
          },
          () => {
            /* permissions.query rejected — ignore, fallbacks remain wired */
          }
        );
      } catch {
        // Some browsers throw synchronously for unsupported names.
      }
    };
    wireStatus('geolocation');
    wireStatus('camera');
  }

  // Signal 2: visibilitychange — only re-check when the tab becomes
  // visible. The "hidden" transition tells us nothing useful.
  if (typeof document !== 'undefined') {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') notify();
    };
    document.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() =>
      document.removeEventListener('visibilitychange', onVisibility)
    );
  }

  // Signal 3: window.focus — covers browsers where visibilitychange does
  // not fire on tab refocus (some embedded webviews).
  if (typeof window !== 'undefined') {
    const onFocus = (): void => notify();
    window.addEventListener('focus', onFocus);
    cleanups.push(() => window.removeEventListener('focus', onFocus));
  }

  return {
    unsubscribe(): void {
      disposed = true;
      for (const c of cleanups.splice(0)) {
        try {
          c();
        } catch (err) {
          log.warn('subscribePermissionChanges: cleanup failed', err);
        }
      }
    },
  };
}

/**
 * Request all mandatory permissions that haven't been granted yet.
 * Shows browser prompts for each permission that needs requesting.
 *
 * This now includes the WebXR+Depth probe to trigger the "3D map" permission
 * upfront, rather than surprising users with a second prompt after "Enter AR".
 *
 * @returns Updated permission check result after requests
 */
export async function requestAllPermissions(): Promise<PermissionCheckResult> {
  // First check current state
  const result = await checkAllPermissions();

  // Request WebXR with depth-sensing to trigger "3D map" permission prompt
  // This is done even if checkWebXRSupport returned supported=true, because
  // the depth-sensing permission is separate and only triggered by requestSession
  if (result.webxr.supported) {
    result.webxr = await requestWebXRWithDepthPermission();
  }

  // Request camera if not yet granted
  if (result.camera.supported && result.camera.granted !== true) {
    result.camera = await requestCameraPermission();
  }

  // Request orientation if not yet granted (iOS)
  if (result.orientation.supported && result.orientation.granted !== true) {
    result.orientation = await requestOrientationPermission();
  }

  // Request geolocation LAST (D6 item 2, 2026-06-16 RecorderApp user feedback):
  // ask the AR essentials (WebXR/depth, camera) first, then orientation, and
  // prompt for Location/GPS at the end so it doesn't interrupt the AR+camera
  // flow. The recorder's permission rows mirror this order in index.html.
  if (result.geolocation.supported && result.geolocation.granted !== true) {
    result.geolocation = await requestGeolocationPermission();
  }

  // Note: File system permission is requested separately via folder picker
  // (see initStorage in file-system.ts). It's not part of the permissions
  // button flow, but the state is tracked here for display purposes.
  // Re-read the file system state in case folder was selected during setup
  result.fileSystem = checkFileSystemPermission();

  // Recalculate allMandatoryReady (including file system)
  result.allMandatoryReady = computeAllMandatoryReady(result);

  return result;
}

/**
 * Request WebXR permission with depth-sensing by starting a probe session.
 *
 * The depth-sensing permission (ARCore's "3D map of surroundings") is only
 * triggered when an XR session is actually started with depth-sensing options.
 * This function starts a minimal probe session to trigger the permission prompt,
 * then immediately ends it.
 *
 * This allows the app to request all AR permissions upfront during the
 * setup flow, rather than surprising users with a second prompt when
 * they click "Enter AR".
 *
 * @returns Permission status indicating if AR+depth access was granted
 */
export async function requestWebXRWithDepthPermission(): Promise<PermissionStatus> {
  if (!navigator.xr) {
    return {
      supported: false,
      granted: null,
      error: 'WebXR not available',
    };
  }

  try {
    // Request session with same options as actual recording (including depth-sensing)
    // Note: We omit domOverlay here since it's just a probe and we end immediately
    const sessionOptions: XRSessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['depth-sensing'],
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    };

    const session = await navigator.xr.requestSession(
      'immersive-ar',
      sessionOptions
    );

    // End immediately - we just needed the permission prompt
    // Even if end() fails, the permission was still granted
    try {
      await session.end();
    } catch (endError) {
      log.warn(
        'Probe session end failed (permission still granted):',
        endError
      );
    }

    log.info('WebXR with depth-sensing permission granted');
    return { supported: true, granted: true };
  } catch (err) {
    // User denied or device doesn't support
    const error = err as DOMException;
    log.warn('WebXR depth probe failed:', error);

    if (error.name === 'NotAllowedError') {
      return {
        supported: true,
        granted: false,
        error: 'AR access denied',
      };
    }
    return {
      supported: false,
      granted: null,
      error: error.message,
    };
  }
}
