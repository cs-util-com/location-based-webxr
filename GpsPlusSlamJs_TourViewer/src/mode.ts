/**
 * The page's two modes (guided-setup plan DEC-N1): a `?qr=` launch is a
 * VISITOR arriving through a printed code; the plain page is a CREATOR in
 * the guided setup. Nothing else selects a mode - the `?author=1` flag of
 * the flows plan is gone, and the tester reaches the visitor path through
 * the setup's "open as a visitor" link.
 *
 * Read ONCE at boot, by design: mode switching is a page reload. The AR
 * controller refuses `enable()` while a session is starting/running/
 * stopping, so a mid-session switch could never take effect anyway.
 */
export type ViewerMode = "creator" | "visitor";

export function viewerModeFromSearch(search: string): ViewerMode {
  // Presence, not value: the landing page forwards `?qr=<payload>`
  // untouched, and an unreadable payload is the boot's error to report,
  // not a reason to show a creator the setup.
  return new URLSearchParams(search).has("qr") ? "visitor" : "creator";
}

/** The creator's cursor on a mesh of the surroundings (polish round M5,
 *  B3): the default since the owner's phone test of 2026-10-15 (mesh-cursor
 *  smoothing plan 2026-10-15-0944); `?mesh=0` (or `false`, case and
 *  spaces tolerated, as the debug flag reads `1`/`true`) turns it off. */
export function meshCursorFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("mesh")?.trim().toLowerCase();
  return value !== "0" && value !== "false";
}
