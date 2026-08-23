# AnchorStarter e2e tests

Playwright end-to-end tests for the persistent-anchor starter example.

## Running

```bash
pnpm run test:e2e          # build framework + run the suite (Chromium)
pnpm run test:e2e:headed   # same, with a visible browser
pnpm run test:e2e:ui       # Playwright UI mode for debugging
```

`pnpm test` runs the full gate (`test:core` then `test:e2e`).

> Always use the pnpm scripts — never call `playwright` directly (repo rule).
> The scripts build the framework `dist/` first so Vite serves a fresh build.

## Scope

**Tier 0 + Tier 1** are both implemented. **Tier 0** (`smoke.spec.js`) is the
smoke + E1 capability gate, which needs no browser-API mocking because Playwright
Chromium genuinely lacks WebXR. **Tier 1** (`placement-flow.spec.js` +
`share-link.spec.js`) drives the full application flow over a DEV-only framework
seam (`window.__anchorStarterSeams`, installed by `fakes.js` and statically
stripped from production): boot → onboarding guidance → soft-gated placement →
the `?show=` URL round-trip → copy-link success/failure. The tiers as implemented are
described below.

## Files

- [playwright.config.js](playwright.config.js) — Chromium, port 5181, clipboard
  permissions, framework-build prerequisite.
- [smoke.spec.js](smoke.spec.js) — the Tier 0 cases.
- [fakes.js](fakes.js.md) — installs the DEV seam fakes + the
  `window.__anchorStarterTest` control surface for the Tier 1 specs.
- [placement-flow.spec.js](placement-flow.spec.js) — Tier 1 boot / guidance /
  placement / `?show=` round-trip / failure-revert cases.
- [share-link.spec.js](share-link.spec.js) — Tier 1 copy-link success / failure
  cases.
