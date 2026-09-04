# design-token.ts

- **Purpose:** reads one design-system token (a CSS custom property on `:root`, e.g. `--accent`) from the vendored `design.css`, so the demo can tint WebGL objects with the live value instead of a second literal.
- **Public API:**
  - `readCssToken(name: string, view?: TokenView): string | undefined` — the trimmed computed value of the custom property on the root element, or `undefined` when there is no window (node, workers) or the token is absent/empty. Throws `TypeError` when `name` does not start with `--`.
  - `TokenView` — the slice of `window` the reader needs (`document.documentElement`, `getComputedStyle`); injectable for tests, defaults to `globalThis.window`.
- **Invariants & assumptions:**
  - `undefined` means "omit the option": callers spread the result conditionally (`...(accent === undefined ? {} : { indicatorColor: accent })`) so the framework default applies. An empty string must never be forwarded — `THREE.Color` reads it as black.
  - The reader does not validate the value's format; the framework's `validateWayfindingHudOptions` rejects non-colour shapes, and the design system's `check-tokens.mjs` keeps the token a hex colour.
  - Reads are cheap (`getComputedStyle` on the root) and happen once per HUD creation, never per frame.
- **Examples:** `createWayfindingHud({ ..., ...(readCssToken("--accent") === undefined ? {} : { indicatorColor: readCssToken("--accent") }) })` — see `ar-mode.ts` / `desktop-sim.ts`.
- **Tests:** `design-token.test.ts` (present, absent/empty, no window, bad name); the wiring is asserted in `ar-mode.test.ts` and `desktop-sim.test.ts` with the reader mocked both ways. `tests/repo-config/design-accent-copies.test.js` (webxr root) holds the framework's default literal to the same token.
