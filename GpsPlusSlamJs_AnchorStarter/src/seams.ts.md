# `seams.ts` — DEV-only framework test seam (Option A)

- **Purpose:** A single, side-effect-free indirection that lets the Playwright
  e2e suite inject AR/GPS fakes into the otherwise glue-only `main.ts`. It reads
  the framework/marker functions from an optional `window.__anchorStarterSeams`
  override, falling back to the real imports. See
  [the e2e test plan §5/§8](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md).
- **Public API:**
  - `interface AnchorStarterSeams` — the set of framework/marker functions a fake
    may override (`checkWebXRSupport`, `checkGeolocationPermission`, `initAR`,
    `getArWorldGroup`, `endARSession`, `getCamera`,
    `startGpsWatch`, `startOrientationWatch`,
    `requestDeviceOrientationPermission`, `createGpsAnchor`,
    `createWayfindingHud`, `enableArWorldGroupAlignment`,
    `selectTrackingQuality`, `selectAlignmentMatrix`, `startReticleHitTest`,
    `createAnchorMarker`).
    `selectAlignmentMatrix` lets the e2e fake drive the placement alignment gate
    (a desktop browser never computes a real alignment); `startReticleHitTest`
    lets it drive the hit-test reticle (surface present / absent) deterministically.
    Since the framework's setter fold, the tracking store + restart callback
    ride into `initAR` as its `callbacks.tracking` group (they arrive TOGETHER;
    without the group the framework forwards no per-frame poses and the
    onboarding guidance silently pins to "AR tracking lost"). `initAR` is
    routed through the seam so the e2e fake can intercept the call and assert
    the group was passed (regression guard in `placement-flow.spec.js`).
  - `realSeams: AnchorStarterSeams` — the production seams (the unmodified
    imports), exported for the prod-inert unit test.
  - `getSeams(): AnchorStarterSeams` — returns `realSeams` unless a DEV-only
    override is present; `main.ts` calls this at every framework call site.
  - Augments the global `Window` with the optional `__anchorStarterSeams`.
- **Invariants & assumptions:**
  - **Prod-inert guarantee:** the override is only consulted under
    `import.meta.env.DEV && !import.meta.env.VITEST`. In a production build
    `import.meta.env.DEV` is statically `false`, so Vite strips the whole branch
    and the `window` read does not exist in the shipped bundle. During unit tests
    (`VITEST`) the override is ignored, so the seam can never swap behaviour for
    real users. The e2e suite runs against `pnpm dev` (where `DEV` is `true` and
    `VITEST` is unset), so the override is active only there.
  - The module must stay **side-effect free** so it can be imported by a unit
    test (no DOM bootstrap, no `main()` call).
- **Examples:** an e2e test installs fakes via `page.addInitScript`:
  `window.__anchorStarterSeams = { initAR: async () => {}, getCamera: () => cam, … }`.
- **Tests:** [seams.test.ts](seams.test.ts) verifies the prod-inert guard
  (returns `realSeams` with no override; ignores a `window` override under
  `VITEST`). The framework barrels are mocked there because they transitively
  load Leaflet, which touches `window` at import time and crashes in node; the
  real wiring is exercised by the Tier 1 e2e suite in a browser.
