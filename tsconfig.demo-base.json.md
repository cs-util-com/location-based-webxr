# tsconfig.demo-base.json

- **Purpose:** the single source of truth for the demo/consumer apps' compiler
  strictness profile. The five demo apps' `tsconfig.app.json` files were
  content-identical; each now `extends` this base (simplify loop Area 13,
  2026-07-18), so a strictness change (e.g. a new `strict`-family flag)
  propagates to all demos in one edit — and demo app #6 copies less.
- **Consumers:** `GpsPlusSlamJs_AnchorStarter`, `GpsPlusSlamJs_QrTrackingDemo`,
  `GpsPlusSlamJs_PhysicsDemo`, `GpsPlusSlamJs_WayfindingHudDemo`,
  `GpsPlusSlamJs_Landing` — each via `"extends": "../tsconfig.demo-base.json"`
  in its `tsconfig.app.json` (whose `tsconfig.vitest.json` /
  `tsconfig.eslint.json` chain onto it unchanged).
- **Invariants & assumptions:**
  - ONLY location-independent options live here. `types`,
    `tsBuildInfoFile`, `include`, `exclude` resolve relative to the declaring
    file and stay per-package (the base would otherwise point them at the
    workspace root — wrong node_modules for `types`, one shared
    `.tsbuildinfo` for five projects).
  - AppFramework, RecorderApp and MinimalExample deliberately do NOT extend
    this (different `module`/`lib`/`allowJs`/`paths` profiles; RecorderApp has
    its own local `tsconfig.base.json`).
- **Tests:** guarded by every demo package's `typecheck` /
  `typecheck:tests` stage in the workspace `pnpm test` cascade.
