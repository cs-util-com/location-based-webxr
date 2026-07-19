/**
 * Palette controller: persisted color-palette choice with a dusk default.
 *
 * Round-2 R19 turned the light/dark toggle into a CYCLE over five curated
 * palettes. Resolution rule (must stay in sync with the inline FOUC-guard
 * script in index.html, which applies the same logic before first paint):
 * a validly persisted palette id wins; anything else falls back to
 * `"dusk"` unconditionally — the golden-hour restyle (2026-07-19) made
 * the cinematic dusk look the first-visit brand statement, with no
 * `prefers-color-scheme` branch. The controller owns the rule after boot
 * and pushes every change through the injected `applyTheme` seam, which
 * the bootstrap wires to BOTH the DOM (`data-theme` attribute → CSS
 * custom properties) and the 3D palette.
 *
 * All browser APIs are injected seams so the module tests in plain node:
 * storage failures (Safari private mode, blocked third-party storage) are
 * swallowed — the visual cycle must keep working without persistence.
 */

/** Cycle order of the palette button (the five curated palettes). */
export const THEME_IDS = ["light", "dark", "neon", "dusk", "mono"] as const;

/** The hidden 6th palette (easter-egg catalog №4): a valid persisted +
 * applyable theme that stays OUT of the normal cycle until unlocked by
 * rapid cycling (see `secret-palette.ts`). */
export const SECRET_THEME_ID = "terminal";

/** Every valid theme id (cycle palettes + the hidden terminal) — the set
 * `resolveInitialTheme` and the index.html FOUC guard accept. */
export const ALL_THEME_IDS = [...THEME_IDS, SECRET_THEME_ID] as const;

export type Theme = (typeof ALL_THEME_IDS)[number];

export const THEME_STORAGE_KEY = "gps-landing-theme";

/** Narrow storage seam; null when localStorage is unavailable entirely. */
type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export interface ThemeEnvironment {
  readonly storage: ThemeStorage | null;
  /** Receives every palette change, including the initial resolution. */
  readonly applyTheme: (theme: Theme) => void;
  /** Whether the hidden terminal palette is unlocked (catalog №4); when
   * true it joins the cycle. Defaults to always-locked. */
  readonly isSecretUnlocked?: () => boolean;
}

export interface ThemeController {
  readonly theme: Theme;
  /** Advances to the next palette, applies + persists it, returns it. */
  cycle(): Theme;
  /** Apply + persist a specific valid palette (e.g. jumping straight to
   * the terminal palette the moment it unlocks). */
  set(theme: Theme): Theme;
}

function isThemeId(value: unknown): value is Theme {
  return (
    typeof value === "string" &&
    (ALL_THEME_IDS as readonly string[]).includes(value)
  );
}

/** Pure resolution rule shared conceptually with the index.html FOUC guard. */
export function resolveInitialTheme(stored: string | null): Theme {
  if (isThemeId(stored)) {
    return stored;
  }
  return "dusk";
}

function readStoredTheme(storage: ThemeStorage | null): string | null {
  try {
    return storage ? storage.getItem(THEME_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function persistTheme(storage: ThemeStorage | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; the in-page cycle must keep working.
  }
}

export function createThemeController(env: ThemeEnvironment): ThemeController {
  let theme = resolveInitialTheme(readStoredTheme(env.storage));
  env.applyTheme(theme);

  const cycleOrder = (): readonly Theme[] =>
    env.isSecretUnlocked?.() ? [...THEME_IDS, SECRET_THEME_ID] : THEME_IDS;

  return {
    get theme() {
      return theme;
    },
    cycle() {
      const order = cycleOrder();
      // If the current palette isn't in the (possibly shrunk) order,
      // start the cycle from its beginning.
      const index = order.indexOf(theme);
      theme = order[(index + 1) % order.length] ?? "dusk";
      env.applyTheme(theme);
      persistTheme(env.storage, theme);
      return theme;
    },
    set(next: Theme) {
      theme = next;
      env.applyTheme(theme);
      persistTheme(env.storage, theme);
      return theme;
    },
  };
}
