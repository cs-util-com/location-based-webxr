# `theme.ts` — persisted palette-cycle controller

## Purpose

Owns the page's color palette (round-2 R19: five curated palettes
cycled by the palette button, not a light/dark toggle): resolves the
initial value (persisted id wins, else the unconditional `"dusk"`
default — the golden-hour restyle of 2026-07-19 made the cinematic dusk
look the first-visit brand statement; there is deliberately NO
`prefers-color-scheme` branch), advances on `cycle()`, persists the
choice, and pushes every change through one `applyTheme` seam that the
bootstrap wires to both the DOM (`data-theme` → CSS custom properties)
and the 3D scene palette.

## Public API

- `THEME_IDS` — the cycle order: `light, dark, neon, dusk, mono`.
- `SECRET_THEME_ID` (`"terminal"`) + `ALL_THEME_IDS` — the hidden 6th
  palette (easter-egg catalog №4) is a VALID theme (persistable,
  applyable, FOUC-guard-accepted) but stays OUT of the cycle until
  `env.isSecretUnlocked()` returns true, at which point it joins the
  cycle after `mono`. Unlock logic lives in `secret-palette.ts`.
- `resolveInitialTheme(stored) → Theme` — pure resolution rule: any
  valid stored id wins; anything else (null, garbage) falls back to
  `"dusk"`. Also reused by `main.ts` to validate the FOUC-stamped
  `data-theme` attribute for the scene's `initialTheme`.
- `createThemeController(env: ThemeEnvironment) → ThemeController`
  - `env.storage: ThemeStorage | null` — narrowed localStorage seam.
  - `env.applyTheme(theme)` — called once at creation and on every cycle.
  - `env.isSecretUnlocked?()` — when true, `terminal` joins the cycle.
  - Controller: `theme` (current value), `cycle() → Theme`, `set(theme)
→ Theme` (jump straight to any valid palette + persist — used to
    switch to `terminal` the moment it unlocks).
- `THEME_STORAGE_KEY` (`"gps-landing-theme"`), `Theme`, `ThemeEnvironment`,
  `ThemeController`. (The narrow `ThemeStorage` seam type is module-private —
  `env.storage` is typed structurally.)

## Invariants & assumptions

- **Must stay in sync with the inline FOUC-guard script in `index.html`**,
  which duplicates the resolution rule (same storage key, same
  valid-id list, same unconditional dusk fallback) to set
  `data-theme` before first paint — AND with the CSS: every id in
  `THEME_IDS` needs an `html[data-theme="<id>"]` custom-property block in
  index.html and a `ScenePalette` in `scene/palette.ts` (test-pinned via
  the palette completeness test).
- **Storage is best-effort:** `getItem`/`setItem` throwing (Safari private
  mode, blocked storage) or `storage === null` never breaks the cycle —
  persistence is silently skipped.
- `applyTheme` is invoked exactly once at creation (with the resolved
  initial theme) and once per cycle step.
- No browser globals are touched — all environment access is injected, so
  the module tests in plain node.

## Examples

```ts
const controller = createThemeController({
  storage: safeLocalStorage(), // null when access throws
  applyTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    scene?.applyPalette(theme);
  },
});
themeToggleButton.addEventListener("click", () => controller.cycle());
```

## Tests

`theme.test.ts` — persisted-over-default resolution, dusk fallback for
missing/garbage values (no OS branch), initial apply-once, cycle
order+persist+apply, throwing/absent storage resilience.
