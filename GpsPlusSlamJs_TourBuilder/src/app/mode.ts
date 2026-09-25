export type AppMode = "authoring" | "viewing";

/** Pure. `?tour=` presence decides the mode (contract D13). */
export function resolveAppMode(url: URL): AppMode {
  return url.searchParams.has("tour") ? "viewing" : "authoring";
}

/**
 * Pure. `?preview=1` offers the desktop preview even on a device that can run
 * AR — how an author checks the preview from the phone they authored on. Where
 * AR is unavailable the preview is offered regardless of this flag.
 */
export function isPreviewRequested(url: URL): boolean {
  return url.searchParams.get("preview") === "1";
}
