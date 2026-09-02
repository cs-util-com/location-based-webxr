# vendor.mjs — copy design.css into the apps that adopted it

- Purpose: the distribution mechanism of the design system (adoption plan
  DEC-L2-3, option e): each adopting app holds a **verbatim copy** of
  `design.css` next to its `index.html` and links it; this script writes
  the copies. A copy, not a workspace dependency, because a dependency
  would make every catalog taste tweak run every consuming app's gate
  (`test:changed` runs a package plus its dependents) - minutes of
  TypeScript that cannot see a CSS regression - while the catalog's own
  gate is seconds-cheap on purpose. Precedent with the same reasoning:
  `tests/repo-config/escape-html-copies.test.js`.
- Public API (CLI): `pnpm run vendor` refreshes every app that already
  holds a copy; `pnpm run vendor -- <AppDir>` adds an app (its first copy)
  and then refreshes all. Exit 2 if a named directory has no `index.html`.
  Prints one line per copy written.
- Invariants & assumptions:
  - **The app list is the filesystem**: every `../GpsPlusSlamJs_*/design.css`
    is a holder. Neither this script nor the guard hard-codes the list,
    so there is exactly one source of truth - the copies themselves.
  - The copy is byte-verbatim (`copyFileSync`), no injected header: the
    guard compares bytes, and a "do not edit" notice belongs in the app's
    `index.html` next to the `<link>`. The apps' format stage globs only
    `src`, `config`, `playwright-tests`, `scripts`, `index.html` (and
    `src/**/*.css` for the recorder), so nothing reformats a root-level
    copy behind the guard's back.
  - `tests/repo-config/design-css-copies.test.js` is what makes the copy
    safe: byte-identical (CRLF-normalised) to the canonical file, every
    linker holds a copy, every copy is linked, and the link precedes the
    app's own `<style>` so the `@layer` order is fixed first.
  - Vendoring is a **deliberate step per app**, never automatic: an app
    upgrades to the current language when its sync commit says so, which
    is the version pinning the plan's drift section needed.
- Examples: after a catalog round, `pnpm run vendor` → the guard goes
  from red ("AnchorStarter/design.css drifted") to green. Adding the
  next demo: `pnpm run vendor -- GpsPlusSlamJs_QrTrackingDemo`, then add
  the `<link>` to its `index.html`.
- Tests: none of its own (a copy loop); the guard test above is its
  contract and fails the root gate on every way a copy can be wrong.
