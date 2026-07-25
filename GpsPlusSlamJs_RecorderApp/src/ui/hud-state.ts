/**
 * Shared mutable state of the recorder HUD, made explicit as one module so
 * the per-panel `hud-*` files extracted from the monolithic `hud.ts`
 * (simplify-loop Area 5) can share it without importing `hud.ts` itself
 * (which re-exports the panels — a value import back into it would be a
 * cycle).
 *
 * Everything here is written by `initUI()` / the setter functions in the
 * owning panels and read across panels; keep this surface MINIMAL — a field
 * belongs here only when more than one panel genuinely needs it.
 */

/** Callback functions the host app wires into the HUD via `initUI()`. */
export interface UICallbacks {
  onOpenFolder: () => Promise<void>;
  onChooseSaveLocation: () => Promise<void>;
  onEnterAR: () => Promise<void>;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onMarkRefPoint: () => Promise<void>;
  onMarkNewRefPoint: () => Promise<void>;
  onToggleMap: () => void;
  onMapZoomIn: () => void;
  onMapZoomOut: () => void;
  onScenarioChange: (scenarioName: string) => void;
  onRequestPermissions: () => Promise<void>;
}

/** Required UI elements cached once during `initUI()` (fail-fast lookups). */
export interface HudCachedElements {
  btnEnterAR: HTMLButtonElement;
  scenarioSelect: HTMLSelectElement;
  btnStart: HTMLElement;
  btnStop: HTMLElement;
  btnRefPoint: HTMLElement;
  btnNewRefPoint: HTMLElement;
  recordingIndicator: HTMLElement;
}

export const hudState: {
  /** Host callbacks; set by `initUI()`, null before init / in tests. */
  callbacks: UICallbacks | null;
  /** Permission status for Enter-AR button validation. */
  permissionsReady: boolean;
  /**
   * Storage status for Enter-AR button validation (Issue 1a-fix).
   * (The parallel `folderSelected` flag was removed 2026-07-10,
   * quality-review D-3 — it was write-only production state; only a test
   * read it.)
   */
  saveLocationSelected: boolean;
  /** Cached references to required UI elements, set during `initUI()`. */
  cachedElements: HudCachedElements | null;
} = {
  callbacks: null,
  permissionsReady: false,
  saveLocationSelected: false,
  cachedElements: null,
};
