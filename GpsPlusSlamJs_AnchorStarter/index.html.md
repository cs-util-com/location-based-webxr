# `index.html` — starter app shell

- **Purpose:** Static shell Vite serves. Hosts the AR mount point and the
  overlay UI the glue (`src/main.ts`) drives.
- **Structure:**
  - `#app` — full-screen container `initAR` mounts the WebXR canvas into.
  - `#overlay` — pointer-passthrough layer holding three panels:
    - `#guidance` (top) — onboarding meter: `#guidance-title`,
      `#guidance-bar` / `#guidance-bar-fill`, `#guidance-percent`,
      `#guidance-hint`.
    - `#start-screen` (centre) — intro + `#start-button` (user gesture to
      start AR) + `#capability-message` (E1 fallback).
    - `#placement` (bottom) — `#banner`, `#error`, `#place-button`,
      `#copy-link-button` (the reload hint went with DEC-L2-10).
- **Invariants & assumptions:** every element `main.ts` reads is present by
  `id`; `main.ts` throws on a missing id. `data-testid` attributes mirror the
  ids for future e2e selectors. AR/guidance/placement panels start `hidden`
  and are revealed after the AR session boots.
- **Tests:** no unit test (static markup); the view-model → DOM mapping logic
  is covered by `guidance-view.test.ts` / `placement-view.test.ts`.
- **See also:** [src/main.ts.md](src/main.ts.md).
