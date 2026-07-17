/**
 * Mode detection — decide whether this device runs the live AR path or the
 * desktop walk simulator.
 *
 * The demo is dual-mode: on a WebXR-capable device it runs a live AR session
 * with tap-to-place waypoints; everywhere else (desktop, no `immersive-ar`)
 * the walk simulator auto-starts. The single signal is whether the browser
 * supports an `immersive-ar` WebXR session (PhysicsDemo pattern).
 */

/** The subset of `XRSystem` we probe (kept structural so tests need no polyfill). */
export interface XrLike {
  isSessionSupported?(mode: string): Promise<boolean>;
}

/**
 * Resolve to `true` when the browser can start an `immersive-ar` WebXR session.
 * Defensive: a missing `navigator.xr`, a missing `isSessionSupported`, or a
 * throwing/rejecting probe all resolve to `false` (run the simulator, never
 * crash).
 */
export async function detectArSupport(
  xr: XrLike | undefined = (navigator as Navigator & { xr?: XrLike }).xr,
): Promise<boolean> {
  if (!xr || typeof xr.isSessionSupported !== "function") {
    return false;
  }
  try {
    return await xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
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
