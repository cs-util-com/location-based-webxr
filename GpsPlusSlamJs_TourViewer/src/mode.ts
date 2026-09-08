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
