/**
 * Mode detection — decide whether this device runs the live AR path or the
 * desktop-replay path.
 *
 * The demo is dual-mode: on a WebXR-capable device it runs a live AR physics
 * session; everywhere else (desktop, no `immersive-ar`) it offers to replay a
 * recorded session (the developer harness). The single signal is whether the
 * browser supports an `immersive-ar` WebXR session.
 */

/** The subset of `XRSystem` we probe (kept structural so tests need no polyfill). */
export interface XrLike {
  isSessionSupported?(mode: string): Promise<boolean>;
}

/**
 * Resolve to `true` when the browser can start an `immersive-ar` WebXR session.
 * Defensive: a missing `navigator.xr`, a missing `isSessionSupported`, or a
 * throwing/rejecting probe all resolve to `false` (offer replay, never crash).
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
