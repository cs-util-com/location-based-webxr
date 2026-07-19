import { describe, expect, it, vi } from "vitest";
import {
  createThemeController,
  resolveInitialTheme,
  THEME_IDS,
  THEME_STORAGE_KEY,
} from "./theme";

// Why this test matters: the palette is a first-paint-visible product
// decision (the golden-hour restyle made DUSK the unconditional first-visit
// default — the cinematic look IS the brand statement; the choice persists
// across visits) and it drives BOTH the CSS custom properties and the 3D
// palette. Round-2 turned the light/dark toggle into a CYCLE over five
// curated palettes — these tests pin the cycle order, the persistence of
// every id, and the resolution rules the inline FOUC-guard script in
// index.html duplicates.

describe("resolveInitialTheme", () => {
  it("uses any validly persisted palette id over the default", () => {
    expect(resolveInitialTheme("light")).toBe("light");
    expect(resolveInitialTheme("dark")).toBe("dark");
    expect(resolveInitialTheme("neon")).toBe("neon");
    expect(resolveInitialTheme("dusk")).toBe("dusk");
    expect(resolveInitialTheme("mono")).toBe("mono");
  });

  it("falls back to dusk for missing or garbage stored values (first visit = golden hour, regardless of OS scheme)", () => {
    // The restyle decision (2026-07-19): NO prefers-color-scheme branch —
    // every first-time visitor lands on the cinematic dusk look.
    expect(resolveInitialTheme(null)).toBe("dusk");
    expect(resolveInitialTheme("solarized")).toBe("dusk");
    expect(resolveInitialTheme("")).toBe("dusk");
  });
});

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    store,
  };
}

describe("createThemeController", () => {
  it("applies the resolved initial palette once on creation", () => {
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "neon" }),
      applyTheme,
    });
    expect(controller.theme).toBe("neon");
    expect(applyTheme).toHaveBeenCalledExactlyOnceWith("neon");
  });

  it("cycle walks through every palette in order and persists each step", () => {
    const storage = makeStorage();
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage, // empty: initial resolves to the dusk default
      applyTheme,
    });
    expect(controller.theme).toBe("dusk");

    // From dusk the cycle continues with the ids after it, wrapping.
    const duskIndex = THEME_IDS.indexOf("dusk");
    const expected = [
      ...THEME_IDS.slice(duskIndex + 1),
      ...THEME_IDS.slice(0, duskIndex + 1),
    ];
    for (const id of expected) {
      expect(controller.cycle()).toBe(id);
      expect(applyTheme).toHaveBeenLastCalledWith(id);
      expect(storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, id);
    }
    // Full loop: back at the start.
    expect(controller.theme).toBe("dusk");
  });

  it("keeps cycling even when storage is unavailable or throws", () => {
    // Safari private mode throws on setItem; storage can be null when
    // localStorage access itself throws. The visual cycle must still work.
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const applyTheme = vi.fn();
    const withThrowing = createThemeController({
      storage: throwingStorage,
      applyTheme,
    });
    expect(withThrowing.cycle()).toBe("mono"); // dusk default → next id
    expect(applyTheme).toHaveBeenLastCalledWith("mono");

    const withoutStorage = createThemeController({
      storage: null,
      applyTheme: () => {},
    });
    expect(withoutStorage.cycle()).toBe("mono");
  });

  it("keeps the hidden terminal palette OUT of the cycle until unlocked (catalog №4)", () => {
    const applyTheme = vi.fn();
    let unlocked = false;
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "mono" }),
      applyTheme,
      isSecretUnlocked: () => unlocked,
    });
    // Locked: mono wraps back to light, never terminal.
    expect(controller.cycle()).toBe("light");

    // Unlocked: terminal joins the cycle after mono.
    unlocked = true;
    controller.set("mono");
    expect(controller.cycle()).toBe("terminal");
    expect(controller.cycle()).toBe("light"); // wraps past terminal
  });

  it("set() jumps straight to a valid palette and persists it", () => {
    const storage = makeStorage();
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage,
      applyTheme,
    });
    expect(controller.set("terminal")).toBe("terminal");
    expect(controller.theme).toBe("terminal");
    expect(applyTheme).toHaveBeenLastCalledWith("terminal");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "terminal",
    );
  });

  it("resolves a persisted terminal palette on boot (FOUC-guard parity)", () => {
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "terminal" }),
      applyTheme: () => {},
    });
    expect(controller.theme).toBe("terminal");
  });

  it("survives a getItem that throws by falling back to the dusk default", () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    const controller = createThemeController({
      storage: brokenStorage,
      applyTheme: () => {},
    });
    expect(controller.theme).toBe("dusk");
  });
});
