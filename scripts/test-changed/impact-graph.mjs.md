# impact-graph.mjs - which tests, in which packages, a change can reach

- Purpose: the pure cross-package graph behind the per-commit fast gate.
  `test-changed.mjs` asks it which dependent packages a change reaches (only
  those run), and `related-unit.mjs` asks it which of a package's unit tests
  a change outside that package reaches. The I/O lives in
  [workspace-tree.mjs](workspace-tree.mjs.md).
- Public API:
  - `buildImpactGraph({ packages, files, texts })` -> an `ImpactGraph`.
    - `packages`: `{ dir, name, deps, exports }` per workspace package
      (`deps` = every dependency field's names);
    - `files`: every existing repo path (tracked or untracked);
    - `texts`: module path -> source text.
  - `impactOf(graph, changedPaths)` -> `{ tests, packages, fullSuite }`, all
    sorted. `tests`: the reached unit tests inside workspace packages;
    `packages`: every package holding a reached file or a full suite;
    `fullSuite`: `{ dir, reason }` for each package whose whole unit suite
    must run. Paths may use either slash style.
  - `FULL_SUITE_RULES`: the named fallbacks below, each `{ name, test }`.
  - `MODULE_RE`, `isUnitTest(path)` (a `*.test.*` file outside
    `playwright-tests/`).
- Edges (a reverse walk from every changed file):
  - imports: static `from`, `import()`, `vi.mock` and friends, `require`,
    `new URL(...)`, `import.meta.resolve`; a package specifier resolves
    through the package's `exports` (wildcards included) to its source, with
    `dist/` mapped to `src/`;
  - folders: an `import.meta.glob` or a template import with a relative
    prefix (`./kinds/${name}.js`) depends on every file under that prefix's
    folder, not its siblings;
  - config paths: a vite or vitest config depends on every existing module
    it names by a path string (a `setupFiles` entry), relative to the config
    or to the package;
  - readers: a module that reads through `fs` or `fetch` and names a changed
    file's basename; across packages it must also name that file's package
    directory;
  - scanners: a unit test that walks a tree (`readdirSync`, `readdir(`,
    `globSync`, `fs.glob`, `opendirSync`) is reached by any non-test module
    change in its own package or in a package directory it names. An
    `import.meta.glob` is not a scanner: its folder edge is exact.
- Fallbacks (`FULL_SUITE_RULES`; each runs the package's whole suite and its
  dependents', with the rule's name in the reason):
  - `deleted or renamed`: the graph no longer knows the file's importers;
  - `a manifest or tsconfig`;
  - `a vite or vitest config`;
  - `a setup file every test may load`: by basename `setup.*`,
    `test-setup.*`, `vitest.setup.*`, `setupTests.*`; a module that only
    ends in `-setup` (the Tour Viewer's `creator-setup.ts`) is ordinary
    source;
  - `a mock every test may load`: anything under `__mocks__/`.
  - A config, setup file or mock that the change reaches through imports
    (not through a reader edge) runs that package whole, reason
    `<file> imports the change`.
- Invariants & assumptions:
  - Markdown reaches nothing (no unit test reads markdown).
  - A template import whose prefix is not relative draws no edge; the tests
    holding one read only their own package's files, which that package's
    related run covers.
  - Root files (`scripts/`, `tests/`) are walked through but belong to no
    package; a root change falls back to the full cascade in
    `select.mjs`, so the graph is consulted only for package changes.
  - Pure: no `fs`, no `node:path`; the same input gives the same output.
- Evidence: a fault-injection replay over recent commits (each changed module
  made to throw inside vitest workers, each changed JSON corrupted, every
  package's full suite run) found no failing test outside the selected set.
- Example: in the fixture of `impact-graph.test.mjs`, a change to
  `Fw/src/a.ts` reaches `Fw/src/a.test.ts` and, through `import 'fw'`,
  `Tour/src/view.test.ts`, so `packages` is `['Fw', 'Tour']`.
- Tests: `impact-graph.test.mjs` (one case per edge kind and per fallback)
  and `impact-graph.property.test.mjs` (a changed unit test is always
  selected, more changes never select less, order does not matter). Run in
  the root repo-config gate.
