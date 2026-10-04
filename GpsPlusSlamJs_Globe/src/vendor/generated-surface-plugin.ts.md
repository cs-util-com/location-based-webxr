# vendor/generated-surface-plugin.ts - a typed door to the plugin

- Purpose: globe plan 2026-09-26-0539 §7.1. 3d-tiles-renderer 0.5.3 exports
  `GeneratedSurfacePlugin` from its plugins entry but ships no `.d.ts` for
  it; this module re-exports the runtime constructor behind a local
  interface covering the options the globe uses. Drop it when upstream
  ships typings.
- Public API: `GeneratedSurfacePlugin` (constructor), the types
  `GeneratedSurfacePluginOptions` (`overlay`, `projection`,
  `applyOverlayTexture`, `useRecommendedSettings`),
  `GeneratedSurfacePluginInstance` (`overlay`, `projection`) and
  `GeneratedSurfacePluginConstructor`.
- Invariants & assumptions: throws at import if the runtime export is
  missing, so an upgrade that drops it fails loudly rather than at first use.
- Tests: `generated-surface-plugin.test.ts` (the export exists, constructs,
  keeps the overlay, defaults to the ellipsoid).
