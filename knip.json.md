# knip.json (root)

## Purpose

Single source of truth for [knip](https://knip.dev) dead-code detection
across all three workspace packages in the public repo. Replaces the
former per-package `GpsPlusSlamJs_RecorderApp/config/knip.json`.

Why root-level: knip invoked from a subdirectory cannot trace imports
through pnpm workspace symlinks. Running from the workspace root lets
knip resolve cross-package imports natively, which removed several
`ignoreDependencies` entries (`@reduxjs/toolkit`, `gl-matrix`) and
even let us drop those dependencies from `GpsPlusSlamJs_RecorderApp`
entirely after confirming they were only transitively pulled in.

## How it's run

- `pnpm run check:deadcode` at the workspace root (`knip` invocation).
- `GpsPlusSlamJs_RecorderApp`'s `check:deadcode` script delegates here
  via `pnpm --workspace-root run check:deadcode`, so per-package
  invocations remain ergonomic but use the single root config.
- CI runs the root invocation in a dedicated `deadcode` job
  (see `.github/workflows/ci.yml`).

## Severity policy

- `dependencies`, `files`, `unlisted`, `duplicates`, `binaries`,
  `unresolved`, `enumMembers`, `classMembers`: knip default (`error`).
  These are CI gates.
- `exports`, `types`: `error` — unused exported symbols and types fail the
  gate (flipped from the interim `warn` after the 2026-04-28 unused-exports
  follow-up landed).

## Per-workspace configuration notes

- **GpsPlusSlamJs_AppFramework** — barrels listed under
  [`src/index.ts`](../GpsPlusSlamJs_AppFramework/src/index.ts) and
  per-module `index.ts` files are entry points because the package is
  consumed externally via the `exports` map. Test utilities under
  [`src/test-utils/`](../GpsPlusSlamJs_AppFramework/src/test-utils/)
  are also entries (consumed by sibling packages' tests). The ambient
  declaration files
  [`src/types/global.d.ts`](../GpsPlusSlamJs_AppFramework/src/types/global.d.ts)
  and
  [`src/types/webxr.d.ts`](../GpsPlusSlamJs_AppFramework/src/types/webxr.d.ts)
  are listed as entries too: they carry only `declare global`
  augmentations (no named exports), so knip cannot trace their usage
  and would otherwise flag them as unused files (an `error`-severity
  gate). There is intentionally **no** `src/ref-points/index.ts` entry —
  that module does not exist in this package; a stale entry produced a
  "no matches" configuration hint. `dpdm` is in `ignoreDependencies` because the framework's
  `check:cycles` command moved from an inline package.json script into
  `scripts/test-timing/projects.mjs` (2026-07-21 gate wiring), where
  knip's package.json-script analysis cannot see it — the standard
  treatment documented in the projects.mjs header, matching every app
  package. `redux` is in `ignoreDependencies`:
  no source file imports it directly, but it must be a **direct**
  dependency so tsdown externalizes redux types in the built d.ts
  instead of bundling them into a private, non-`exports`-reachable
  chunk (TS2883 in `composite` consumers). Pinned by
  [tests/repo-config/framework-dts-portability.test.js](tests/repo-config/framework-dts-portability.test.js).
- **GpsPlusSlamJs_RecorderApp** — main entry is auto-detected from
  `package.json` "main"/"module"; we explicitly list `src/global.d.ts`,
  `playwright-tests/**`, and the stylelint config. Non-source tooling
  packages (`stylelint-config-standard`, `postcss-html`, etc.) are
  ignored because knip cannot trace them through their own configs.
- **GpsPlusSlamJs_MinimalExample** — `gps-plus-slam-js` is in
  `dependencies` to demonstrate the install path (anonymous npm
  registry resolution, see [§C9 in the public-repo plan](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-30-separate-public-repo-plan.md#phase-c-public-repo-infrastructure))
  even though `main.ts` only imports from
  `gps-plus-slam-app-framework`. Ignored to keep that dependency
  declaration honest.
- **GpsPlusSlamJs_AnchorStarter** — `src/main.ts` is the runtime root,
  auto-detected from `index.html` by knip's Vite plugin (listing it as an
  explicit `entry` is redundant and knip warns about it). Only the
  stylelint config is listed as an explicit entry. The stylelint tooling
  packages (`stylelint-config-standard`, `postcss-html`,
  `@carlosjeurissen/stylelint-csstree-validator`) are ignored because
  knip cannot trace them through the stylelint config, mirroring the
  RecorderApp treatment.
- **GpsPlusSlamJs_Landing** — same shape as the AnchorStarter: Vite
  plugin auto-detects `src/main.ts` from `index.html`; explicit entries
  for the stylelint config and `playwright-tests/**` (the e2e smoke
  suite); the three stylelint tooling packages ignored.
- **GpsPlusSlamJs_OsmDemo** — two entries are listed explicitly because
  knip's Vite plugin finds neither of them. `src/worker/demo-worker.ts`
  is reached through `new Worker(new URL(...), { type: "module" })`,
  which is a runtime construction rather than an import. And
  `src/gallery-main.ts` is the entry of a **second HTML page**
  (`gallery.html`, the POI model gallery, W7/DEC-R5-5) — the plugin
  auto-detects `index.html` only, so without this line knip reports the
  whole gallery as an unused file and `buildGallery` as an unused export,
  which is how it failed the first time it was added. **If another page
  is ever added, its entry belongs here too.**

## Tests

This config is verified by running it: `pnpm run check:deadcode`. No
unit tests cover it — knip itself is the gate. The
[follow-up doc](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-28-knip-unused-exports-followup.md)
lists the current findings; the report is also visible in CI.

## `tailwindcss` in the recorder's `ignoreDependencies` (2026-08-19)

Knip reads JavaScript and TypeScript, not CSS. The recorder pulls Tailwind in
through `@import "tailwindcss"` in `styles/tailwind.css`, so no `.ts` file
mentions it and knip reports it as an unused devDependency.

**It must nevertheless be a DIRECT dependency**, not a transitive one via
`@tailwindcss/vite`: pnpm's strict `node_modules` layout means a bare
`@import "tailwindcss"` resolves only when the importing workspace declares
the package itself.

The alternative — teaching knip to parse CSS imports — is a much larger change
for one entry. What actually protects this is
`GpsPlusSlamJs_RecorderApp/src/no-external-page-assets.test.ts`: if Tailwind
ever stopped being built and went back to a CDN, that test fails. So the ignore
here cannot hide a regression, only a bookkeeping question knip is not equipped
to answer.
