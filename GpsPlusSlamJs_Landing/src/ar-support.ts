/**
 * AR-capability detection for the CTA's device claim (round-8 Z6).
 *
 * The static HTML ships the universally TRUE sentence ("The demos below
 * run on Android phones with Chrome …") so no device ever reads a wrong
 * promise — with JS disabled, before hydration, and on iOS/desktop it
 * simply stays. On devices whose browser answers `immersive-ar` WebXR
 * support with yes, the claim upgrades to the stronger "run on your
 * phone right now". Progressive enhancement, no flash of a wrong claim.
 */

/** The minimal slice of `navigator.xr` this module needs (injectable). */
export interface XrSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/** Id of the `<span>` in index.html carrying the device claim. */
export const CTA_CLAIM_ELEMENT_ID = "cta-device-claim";

/** The upgraded claim shown ONLY on immersive-ar-capable devices. */
export const CTA_CLAIM_CAPABLE = "The demos below run on your phone right now";

/**
 * How long to wait for `isSessionSupported` before keeping the honest static
 * claim. A wedged OS XR runtime can make the promise NEVER settle
 * (2026-07-24 — it hung the CTA upgrade and the desktop QR-handoff e2e);
 * healthy browsers answer in milliseconds.
 */
export const AR_SUPPORT_PROBE_TIMEOUT_MS = 3000;

/**
 * True iff the browser reports `immersive-ar` WebXR support.
 * `navigator.xr` is untrusted input: absent (iOS Safari, desktop
 * Firefox), malformed, throwing (SecurityError in cross-origin
 * frames), or never answering (wedged OS XR runtime) all resolve to
 * `false` — never a rejection, never a hang.
 */
export async function detectImmersiveArSupport(
  xr: XrSystemLike | null | undefined,
): Promise<boolean> {
  if (!xr || typeof xr.isSessionSupported !== "function") {
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      xr.isSessionSupported("immersive-ar").then((v) => v === true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), AR_SUPPORT_PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upgrade the CTA device claim on capable devices; on unsupported ones
 * (or when the span is missing) the honest static default stays.
 */
export function applyCtaDeviceClaim(
  doc: Pick<Document, "getElementById">,
  supported: boolean,
): void {
  if (!supported) {
    return;
  }
  const claim = doc.getElementById(CTA_CLAIM_ELEMENT_ID);
  if (claim) {
    claim.textContent = CTA_CLAIM_CAPABLE;
  }
}
