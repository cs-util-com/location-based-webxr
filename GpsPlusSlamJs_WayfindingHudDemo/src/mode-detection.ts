/**
 * Mode detection — decide whether this device runs the live AR path or the
 * desktop walk simulator.
 *
 * The demo is dual-mode: on a WebXR-capable device it runs a live AR session
 * with tap-to-place waypoints; everywhere else (desktop, no `immersive-ar`)
 * the walk simulator auto-starts. The single signal is whether the browser
 * supports an `immersive-ar` WebXR session (PhysicsDemo pattern).
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
 * AND a probe that never answers (wedged OS XR runtime, 2026-07-24 — it hung
 * this demo's whole boot) all resolve to `false` (run the simulator, never
 * crash, never hang).
 */
export async function detectArSupport(
  xr: XrLike | undefined = (navigator as Navigator & { xr?: XrLike }).xr,
): Promise<boolean> {
  return probeImmersiveArSupport({ xr });
}

/**
 * The two mutually-exclusive entry hints (structural — tests pass plain
 * objects). `Pick<HTMLElement, "hidden">` tracks the DOM lib's `hidden` type
 * (`string | boolean` — the `"until-found"` value) so real elements assign
 * cleanly.
 */
export interface ModeEntryElements {
  /** The "Start AR" button — shown only on a WebXR-capable device. */
  readonly startArButton: Pick<HTMLElement, "hidden">;
  /** The desktop-simulator hint (WASD/drag help) — shown only on the desktop. */
  readonly simNote: Pick<HTMLElement, "hidden">;
}

/**
 * Show exactly ONE entry path on the mode screen: on a WebXR-capable device
 * the "Start AR" button (hide the simulator hint); everywhere else the
 * simulator hint (hide "Start AR"). Either-or — a phone runs live AR, the
 * desktop walks the simulator.
 */
export function applyModeEntry(
  arSupported: boolean,
  { startArButton, simNote }: ModeEntryElements,
): void {
  startArButton.hidden = !arSupported;
  simNote.hidden = arSupported;
}
