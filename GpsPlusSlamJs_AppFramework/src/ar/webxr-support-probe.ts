/**
 * Timeout-guarded probe for WebXR immersive-ar support.
 *
 * `navigator.xr.isSessionSupported('immersive-ar')` is a browser API that can
 * do more than resolve or reject: on Windows it consults the OS XR runtime,
 * and a wedged runtime makes the promise NEVER settle (observed 2026-07-24 —
 * `'inline'` resolved instantly while `'immersive-ar'` hung forever). Every
 * boot path that awaited it bare hung its whole app: the recorder never
 * reached its replay-mode switch and the wayfinding demo never built its
 * canvas. This module is therefore the ONE place the framework (and the demo
 * apps) ask the question, with the no-answer failure mode handled: missing
 * API, rejection, and timeout all resolve `false` — "can't confirm AR
 * support" and "no AR support" lead to the same non-AR fallback UX.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('WebXRSupportProbe');

/** Structural subset of `XRSystem` the probe touches. */
export interface XrSystemLike {
  isSessionSupported?(mode: string): Promise<boolean>;
}

/**
 * How long the probe waits for `isSessionSupported` before treating the
 * platform as AR-unsupported. On healthy platforms the call resolves in
 * milliseconds; only a wedged XR runtime reaches this.
 */
export const WEBXR_SUPPORT_PROBE_TIMEOUT_MS = 3000;

/**
 * What actually happened when the browser was asked about immersive-ar.
 * Callers that surface user-facing guidance (the permission checker) map
 * `'error'`/`'timeout'` to a "try again" message rather than the
 * "install ARCore" one; boolean callers use {@link probeImmersiveArSupport}.
 */
export type ImmersiveArProbeOutcome =
  | 'supported'
  | 'unsupported'
  | 'error'
  | 'timeout';

/**
 * Ask the browser about immersive-ar support — never hangs, never throws.
 * Missing API and negative answers are `'unsupported'`; a rejection is
 * `'error'`; no answer within the timeout is `'timeout'`. Defaults to
 * `navigator.xr`; pass `xr` explicitly in tests.
 */
export async function probeImmersiveArSupportOutcome(
  options: {
    xr?: XrSystemLike | null | undefined;
    timeoutMs?: number;
  } = {}
): Promise<ImmersiveArProbeOutcome> {
  const xr =
    'xr' in options
      ? options.xr
      : (navigator as Navigator & { xr?: XrSystemLike }).xr;
  const timeoutMs = options.timeoutMs ?? WEBXR_SUPPORT_PROBE_TIMEOUT_MS;

  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return 'unsupported';
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      xr
        .isSessionSupported('immersive-ar')
        .then(
          (supported): ImmersiveArProbeOutcome =>
            supported ? 'supported' : 'unsupported'
        ),
      new Promise<ImmersiveArProbeOutcome>((resolve) => {
        timer = setTimeout(() => {
          log.warn(
            `isSessionSupported('immersive-ar') gave no answer within ${timeoutMs} ms — ` +
              'treating AR as unsupported (wedged OS XR runtime?)'
          );
          resolve('timeout');
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    log.warn("isSessionSupported('immersive-ar') failed:", err);
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Boolean convenience over {@link probeImmersiveArSupportOutcome}: `true`
 * only when the browser positively confirmed support.
 */
export async function probeImmersiveArSupport(
  options: {
    xr?: XrSystemLike | null | undefined;
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  return (await probeImmersiveArSupportOutcome(options)) === 'supported';
}
