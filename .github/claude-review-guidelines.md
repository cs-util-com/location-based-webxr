# Claude review guidelines — location-based-webxr

Apache-2.0 pnpm workspace of TypeScript/Vite packages: `GpsPlusSlamJs_AppFramework/`
(the shared AR+GPS framework — WebXR session management, Three.js visualization,
sensors, storage, replay, store wiring) plus consumer apps and demos
(`_RecorderApp`, `_AnchorStarter`, `_MinimalExample`, `_QrTrackingDemo`,
`_PhysicsDemo`, `_WayfindingHudDemo`, `_OsmDemo`, `_TourViewer`, `_Landing`).
All of these depend on the
published `gps-plus-slam-js` library, which lives in a separate repository.

## Flag these

- **Correctness in geometry, sensors, and XR lifecycle.** Frame/coordinate-system
  mixups, degrees vs radians, WGS84 vs local ENU, quaternion order, and mismatched
  units across a package boundary. XR session state that is not cleaned up on
  `sessionend`, or listeners/animation loops that outlive the session.
- **Unvalidated external data.** Geolocation fixes, WebXR poses, device-orientation
  events, QR payloads, `localStorage`/IndexedDB reads, and URL parameters
  (e.g. `?show=`) must be validated at the boundary. Missing handling for `NaN`,
  absent accuracy fields, out-of-order timestamps, or empty arrays.
- **Cross-package breakage.** A change to `gps-plus-slam-app-framework`'s exported
  surface (see its `exports` map) that silently breaks a consumer app, or a new
  subpath export without a matching entry.
- **Untested hypotheses.** New behavior without a test that would fail if it
  regressed; a bug fix without a test reproducing the bug. Numeric/geometric
  utilities without a property-based test (`*.property.test.ts`, `fast-check`).
- **Missing or stale sidecar docs.** Every production file needs a colocated
  `*.md`. Test files and pure re-export barrel `index.ts` files are exempt. Flag a
  sidecar whose documented invariants no longer match the changed code.
- **Playwright anti-patterns.** `waitForTimeout()` instead of waiting for a
  specific element/state; assertions that depend on timing rather than a condition.
- **Async UI without feedback.** A button or switch that awaits I/O (storage write,
  scenario switch, recording stop) with no in-progress state and no final
  confirmation or error surface.

## Do NOT comment on these

All of the following are already enforced by the root `pnpm test` cascade and CI.
Duplicating them is noise:

- Formatting and code style — Prettier decides.
- Lint rules — ESLint decides.
- Type errors, `strict` violations, or `noUncheckedIndexedAccess` narrowing —
  `tsc --noEmit` (`typecheck` and `typecheck:tests`) decides.
- Unused exports and dead code — knip decides. Import cycles — the cycle check decides.
- CLA signing (a bot handles it), commit-message format, generated `dist/` output,
  and the auto-rewritten `docs/test-timings.md` files.

## Tone

Be direct and specific. Prefer one concrete inline comment with a suggested fix
over a general observation. Do not restate what the diff does. Do not praise.
State confidence when you are unsure rather than hedging in prose.
