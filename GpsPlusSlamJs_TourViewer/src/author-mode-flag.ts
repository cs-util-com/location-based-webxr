/**
 * `?author=1` — the boot-time author-mode flag (QD-1: authoring lives INSIDE
 * the TourViewer, hidden behind this flag so the passerby UI stays clean).
 *
 * Read ONCE at boot, by design: mode switching is a page reload. The AR
 * controller refuses `enable()` while a session is starting/running/stopping,
 * so a mid-session flag flip could never take effect anyway — a URL edit plus
 * reload is the honest switch.
 */
export function authorModeEnabledFromSearch(search: string): boolean {
  // Strict `=== "1"`, matching this app's `?nocache=1` convention: author
  // mode is an opt-in power tool, so anything else (absent, "true", "yes",
  // garbage) stays in the passerby viewer mode.
  return new URLSearchParams(search).get("author") === "1";
}
