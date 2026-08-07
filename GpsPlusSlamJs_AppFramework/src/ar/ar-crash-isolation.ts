/**
 * AR crash isolation flags — diagnostic gates for XR session negotiation.
 *
 * Moved out of the recorder settings catalog (2026-07-11 G-1 move,
 * `2026-07-11-1445-recording-options-altitude-move-plan.md`): the framework itself
 * consumes these flags in `webxr-session.ts` (session feature requests, frame
 * loop) and on `enable-gps-ar.ts`'s public param, so the type + defaults +
 * validator live framework-side. The recorder embeds the group in its own
 * `RecordingOptions` catalog and re-exports the type.
 */

import { validateOptionFields } from '../utils/validate-option-fields.js';

/**
 * Diagnostic flags for isolating pre-recording AR startup crashes.
 * These gates affect XR session negotiation and frame-loop behavior,
 * independently of recording-time image/depth capture.
 */
export interface ArCrashIsolationOptions {
  enableDomOverlay: boolean;
  enableCameraAccess: boolean;
  enableDepthSensingFeature: boolean;
  enableCss3dRenderer: boolean;
  enableCameraTextureAcquisition: boolean;
  /**
   * Apply the Chromium WebXR camera-access tab-crash workaround at app
   * bootstrap. The workaround always deletes
   * `XRWebGLBinding.prototype.createProjectionLayer` /
   * `XRRenderState.prototype.layers` (forcing `XRWebGLLayer`) — required on
   * every affected Chrome build observed on-device, including Chrome 150 — and
   * additionally persists the `baseLayer` across
   * `XRSession.prototype.updateRenderState` only for Chrome builds inside the
   * affected window (148.0.7778.12 up to 149.0.7821).
   *
   * Default `true`. Opt-out is offered because forcing `XRWebGLLayer` may break
   * WebXR on unaffected (e.g. Quest) devices.
   *
   * @see GpsPlusSlamJs_AppFramework/src/ar/chromium-camera-access-workaround.ts
   * @see https://github.com/mrdoob/three.js/issues/33404
   */
  applyChromiumProjectionLayerWorkaround: boolean;
}

/** Default AR-crash-isolation flags (all features enabled). */
export const DEFAULT_AR_CRASH_ISOLATION: ArCrashIsolationOptions = {
  enableDomOverlay: true,
  enableCameraAccess: true,
  enableDepthSensingFeature: true,
  enableCss3dRenderer: true,
  enableCameraTextureAcquisition: true,
  applyChromiumProjectionLayerWorkaround: true,
};

/**
 * Validate and normalize AR crash isolation flags.
 *
 * Boolean-or-default per field (quality-review C-1): persisted/external values
 * are untrusted, so anything that is not a real boolean falls back to the
 * default. The container itself is as untrusted as its fields (persisted blobs
 * may lack the key entirely or hold `null`), so a nullish container yields the
 * full defaults instead of throwing.
 */
export function validateArCrashIsolationOptions(
  rawOptions?: Partial<ArCrashIsolationOptions> | null
): ArCrashIsolationOptions {
  return validateOptionFields(rawOptions, DEFAULT_AR_CRASH_ISOLATION, {
    enableDomOverlay: { kind: 'bool' },
    enableCameraAccess: { kind: 'bool' },
    enableDepthSensingFeature: { kind: 'bool' },
    enableCss3dRenderer: { kind: 'bool' },
    enableCameraTextureAcquisition: { kind: 'bool' },
    applyChromiumProjectionLayerWorkaround: { kind: 'bool' },
  });
}
