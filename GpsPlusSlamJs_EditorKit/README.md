# gps-plus-slam-editor-kit (private)

The globe editor's generic building blocks, taken out of the Tour Viewer's
editor so a second editor can be built from them. Today it holds the shell
chrome; the touch gestures, the 3D scene's blocks and the globe's come as
they move. Design: the private repo's
`GpsPlusSlamJs_Docs/docs/2026-10-27-1850-editor-on-the-full-globe-plan.md`,
"GV5 steps".

## Entries

The kit has four planned entries, stacked: each may import only from the
ones before it (`src/kit-imports.test.ts` holds this, relative and package
imports alike).

- `gps-plus-slam-editor-kit/touch` (`src/touch/`, not created yet) - the
  touch gestures a visitor's page may share. The only entry a visitor's
  page may load.
- `gps-plus-slam-editor-kit/chrome` (`src/chrome/index.ts`) - the shell
  chrome: DOM only, no three. The menu button and its item states
  (`menu-button`), the key target rules (`key-target`), the page-inert
  hold (`page-inert`), the popover placement (`popover-place`), the status
  lines (`status-lines`), the ground wait (`ground-wait`), the shell's
  icons (`shell-icons`), the docks' fold rule and its default layout
  (`dock-rule`), the tree's reorder, drag and click rules (`tree-reorder`,
  `tree-drag`, `tree-click`) and the scene's menu (`scene-menu`). An
  editor's page loads it statically.
- `gps-plus-slam-editor-kit/scene` (`src/scene/`, not created yet) - the 3D
  scene's blocks; brings three. An editor's page reaches it by `import()`
  only.
- `gps-plus-slam-editor-kit/globe` (`src/globe/`, not created yet) - the
  globe's blocks; the only entry that may name `gps-plus-slam-globe`,
  `3d-tiles-renderer` or `gps-plus-slam-osm`. By `import()` only.

## As a dependency of a Vite app

Like `gps-plus-slam-globe`, the kit exports TypeScript SOURCE and has no
build: a consumer adds `"gps-plus-slam-editor-kit": "workspace:*"`, imports
by entry, and Vite transpiles the source; the consumer's `tsc` type-checks
it under the consumer's own options. `"sideEffects": false`, so an unused
block is shaken out. No CSS: the class names and data attributes a block
sets are its contract, and each app styles them.

The Tour Viewer is the first consumer. Its guards hold the entries to the
pages that may load them:

- `src/editor-only-packages.test.ts` - by specifier: no module outside the
  editors names any entry but `./touch`, and none outside the 3D view
  names `./scene` or `./globe` statically;
- `src/editor3d-lazy.test.ts` - in the production bundle: the visitor's
  pages reach no kit module but `touch`, and the editor's page loads of
  the kit only `chrome` and `touch` before an `import()`;
- `config/.dependency-cruiser.cjs` (`viewer-not-to-kit-editor`) - the
  visitor's and the phone's top-level modules and the landing import no
  kit `chrome`, `scene` or `globe`.

A kit change selects the Tour Viewer's gate in full (the served-by edge in
`scripts/test-changed/select.mjs`): its editor e2e is the kit's only
browser check.

## Its own gate

`pnpm test` in this folder runs `format`, `lint`, `check:cycles`,
`typecheck`, `typecheck:tests` and `test:unit` (no e2e, see above). Run a
single test with `pnpm run test:unit src/chrome/<file>.test.ts`.

The kit's `tsconfig.app.json` keeps `erasableSyntaxOnly` for its own files
and resolves a dependency through that dependency's package `exports` and
built types, as the bundler does (the alternative, `paths` into a
dependency's source, type-checked that source under the kit's flags and
failed). It has no dependencies yet; the framework, the globe and `three`
arrive with the blocks that need them.

## Dead code

`knip.json` turns `includeEntryExports` on for this workspace: the kit is
private, so every export of an entry must have a consumer in the
workspace, and an unused one is reported by the root `check:deadcode`
(verified by a planted unused export).
