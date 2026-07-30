/**
 * GPS Module
 *
 * Handles Geolocation API access and device orientation/compass.
 */

import { createLogger } from '../utils/logger';
import { requestOrientationPermission as requestOrientationPermissionStatus } from './permission-checker.js';

const log = createLogger('GPS');

export interface GpsPosition {
  readonly lat: number;
  readonly lon: number;
  readonly altitude: number | null;
  readonly accuracy: number;
  readonly altitudeAccuracy: number | null;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly timestamp: number;
}

/**
 * Raw device orientation from the browser's DeviceOrientationEvent API.
 * Fields are nullable because sensors may be unavailable on some devices.
 * See also: DeviceOrientation in state/tracking-slice.ts (resolved, non-nullable).
 */
export interface RawDeviceOrientation {
  alpha: number | null; // compass direction (0-360)
  beta: number | null; // front-back tilt
  gamma: number | null; // left-right tilt
  absolute: boolean;
}

type GpsCallback = (position: GpsPosition) => void;
type OrientationCallback = (orientation: RawDeviceOrientation) => void;

let watchId: number | null = null;
let orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;

/**
 * Start watching GPS position.
 * Idempotent: clears any existing watch before starting a new one
 * (Issue 4, 2026-02-27 user feedback — prevents watch leaks when
 * transitioning from warm-up to recording watch).
 */
export function startGpsWatch(
  onPosition: GpsCallback,
  onError?: (error: GeolocationPositionError) => void
): void {
  if (!navigator.geolocation) {
    log.error('Geolocation API not available');
    return;
  }

  // Clear any existing watch to prevent leaks (idempotency)
  stopGpsWatch();

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onPosition({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        altitude: pos.coords.altitude,
        accuracy: pos.coords.accuracy,
        altitudeAccuracy: pos.coords.altitudeAccuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      });
    },
    (err) => {
      log.error('Error:', err.message);
      onError?.(err);
    },
    {
      // Android-focused tuning (see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-20-android-altitude-accuracy-audit.md, R1):
      // - enableHighAccuracy forces GNSS instead of Wi-Fi/cell triangulation; without it
      //   Android typically returns altitudeAccuracy=null and the vertical weight in
      //   computeVerticalWeights falls back to latLongAccuracy.
      // - maximumAge=5000 lets the browser reuse a recent fix (up to 5 s old) instead
      //   of forcing a fresh acquisition on every callback, which on weak-fix Android
      //   devices caused frequent TIMEOUT errors.
      // - timeout=15000 gives a cold GNSS chip enough time for a satellite lock.
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }
  );

  log.info('Watch started');
}

/**
 * Stop watching GPS position
 */
export function stopGpsWatch(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    log.info('Watch stopped');
  }
}

/**
 * Start listening for device orientation (compass)
 */
export function startOrientationWatch(
  onOrientation: OrientationCallback
): void {
  // Clear any existing watch to prevent leaks (idempotency)
  stopOrientationWatch();

  orientationHandler = (event: DeviceOrientationEvent) => {
    onOrientation({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      absolute: event.absolute,
    });
  };

  window.addEventListener('deviceorientation', orientationHandler);
  log.info('Orientation watch started');
}

/**
 * Stop listening for device orientation
 */
export function stopOrientationWatch(): void {
  if (orientationHandler) {
    window.removeEventListener('deviceorientation', orientationHandler);
    orientationHandler = null;
    log.info('Orientation watch stopped');
  }
}

/**
 * Request permission for device orientation (required on iOS 13+).
 *
 * Boolean-contract wrapper around the permission-checker's
 * `requestOrientationPermission` superset (quality-review A-4 — the two
 * public implementations had already drifted once; this one lacked the
 * missing-API guard and threw a ReferenceError where `DeviceOrientationEvent`
 * does not exist). `true` only for an explicit grant (or the non-iOS
 * no-permission-needed case); denied, failed, or unsupported → `false`.
 */
export async function requestOrientationPermission(): Promise<boolean> {
  const status = await requestOrientationPermissionStatus();
  return status.granted === true;
}
