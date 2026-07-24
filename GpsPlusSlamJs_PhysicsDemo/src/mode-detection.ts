/**
 * Mode detection — decide whether this device runs the live AR path or the
 * desktop-replay path.
 *
 * The demo is dual-mode: on a WebXR-capable device it runs a live AR physics
 * session; everywhere else (desktop, no `immersive-ar`) it offers to replay a
 * recorded session (the developer harness). The single signal is whether the
 * browser supports an `immersive-ar` WebXR session.
 */

import { probeImmersiveArSupport } from "gps-plus-slam-app-framework/ar/webxr-support-probe";

/** The subset of `XRSystem` we probe (kept structural so tests need no polyfill). */
export interface XrLike {
  isSessionSupported?(mode: string): Promise<boolean>;
}

/**
 * Resolve to `true` when the browser can start an `immersive-ar` WebXR session.
 * Delegates to the framework's timeout-guarded probe: a missing
 * `navigator.xr`, a missing `isSessionSupported`, a throwing/rejecting probe,
 * AND a probe that never answers (wedged OS XR runtime, 2026-07-24) all
 * resolve to `false` (offer replay, never crash, never hang).
 */
export async function detectArSupport(
  xr: XrLike | undefined = (navigator as Navigator & { xr?: XrLike }).xr,
): Promise<boolean> {
  return probeImmersiveArSupport({ xr });
}

/**
 * The two mutually-exclusive entry controls (structural — tests pass plain
 * objects). `Pick<HTMLElement, "hidden">` tracks the DOM lib's `hidden` type
 * (`string | boolean` — the `"until-found"` value) so real elements assign cleanly.
 */
export interface ModeEntryElements {
  /** The "Start AR" button — shown only on a WebXR-capable device. */
  readonly startArButton: Pick<HTMLElement, "hidden">;
  /** The "Load a recording" file-row — shown only on the desktop. */
  readonly fileRow: Pick<HTMLElement, "hidden">;
}

/**
 * Show exactly ONE entry path on the mode screen: on a WebXR-capable device the
 * "Start AR" button (hide the recording file-row); everywhere else the file-row
 * (hide "Start AR"). The demo is either-or — a phone runs live AR, the desktop
 * replays a recording — so showing both was a bug (the file-row used to be
 * unconditionally visible).
 */
export function applyModeEntry(
  arSupported: boolean,
  { startArButton, fileRow }: ModeEntryElements,
): void {
  startArButton.hidden = !arSupported;
  fileRow.hidden = arSupported;
}
