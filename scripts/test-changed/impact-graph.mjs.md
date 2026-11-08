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
    - `texts`: module path -> source text, declaration files and
      `tsconfig*.json` included.
  - `impactOf(graph, changedPaths)` -> `{ tests, packages, fullSuite }`, all
    sorted. `tests`: the reached unit tests inside workspace packages;
    `packages`: every package holding a reached file or a full suite;
    `fullSuite`: `{ dir, reason }` for each package whose whole unit suite
    must run. Paths may use either slash style.
  - `FULL_SUITE_RULES`: the named fallbacks below, each `{ name, test }`.
  - `MODULE_RE`, `TSCONFIG_RE`, `isUnitTest(path)` (a `*.test.*` file, or a
    `*.spec.*` file under a `src/` folder, outside `playwright-tests/`; the
    Recorder's vitest include lists `src/**/*.spec.ts`, while the design
    system keeps Playwright specs beside its pages).
- Edges (a reverse walk from every changed file):
  - imports: static `from`, `import()`, `vi.mock` and friends, `require`,
    `new URL(...)`, `import.meta.resolve`; a package specifier resolves
    through the package's `exports` (wildcards included) to its source, with
    `dist/` mapped to `src/`;
  - folders: an `import.meta.glob` or a template import with a relative
    prefix (`./kinds/${name}.js`) depends on every file under that prefix's
    folder, not its siblings;
  - config paths: a vite or vitest config depends on every existing module
    its `setupFiles` or `globalSetup` names by a path string, relative to the
    config or to the package. Other path strings (a coverage `exclude` naming
    `src/main.ts`) load nothing and draw no edge;
  - config aliases: a `resolve.alias` entry
    (`'name': fileURLToPath(new URL('../dir', import.meta.url))`) is a
    resolution rule for the files of the config's package (`name` and
    `name/sub` resolve under `dir` first), not an import of the config. Read
    as an import, the Recorder's and the globe's alias of the framework to its
    `src` made each config import the framework index, so a change to the Osm
    index ran both whole suites (12 packages, 521 test files, against 11 and
    318 since; r1139);
  - readers: a module that reads through `fs` or `fetch` and names a changed
    file's basename; across packages it must also name that file's package
    directory;
  - scanners: a unit test that walks a tree (`readdirSync`, `readdir(`,
    `globSync`, `fs.glob`, `opendirSync`) is reached by any non-test module
    change in its own package or in a package directory it names. An
    `import.meta.glob` is not a scanner: its folder edge is exact;
  - type-level: a tsconfig program's `include` and `files` entries that point
    into another package draw an edge from every file they compile, so a
    framework change reaches the Recorder, whose `tsconfig.base.json`
    includes `../GpsPlusSlamJs_AppFramework/src/**/*.ts`, and the globe, whose
    tsconfigs name single framework files. Matched as tsc matches: an include
    glob by its own extension (never a `.md` sidecar, never a `.js` under a
    `*.ts` glob), a folder or extensionless glob by module files only, minus
    the program's `exclude` (a `files` entry is never excluded). `include`,
    `files` and `exclude` are inherited through a relative `extends` until a
    config sets its own. A tsconfig that another extends and none
    `references` is a base, not a program: only its extenders count, so the
    Recorder's base reaches no framework test, because its app and vitest
    programs exclude them (before r1139 a framework test file or sidecar
    reached the Recorder). The arrays are read with a pattern, since
    tsconfigs are JSONC. A declaration file's imports are edges, and a
    specifier resolves to a `.d.ts` too.
- Fallbacks (`FULL_SUITE_RULES`; each runs the package's whole suite and its
  dependents', with the rule's name in the reason):
  - `deleted or renamed`: the graph no longer knows the file's importers;
  - `a manifest or tsconfig`;
  - `a vite or vitest config`;
  - `a declaration file` (`*.d.ts`): ambient declarations reach every file
    of a program without an import (`AppFramework/src/types/global.d.ts`);
  - `a build config` (`tsdown`, `tsup`, `rollup`, `rolldown`, `esbuild`,
    `webpack`): it shapes `dist`, which every dependent consumes;
  - `a setup file every test may load`: by basename `setup.*`,
    `test-setup.*`, `vitest.setup.*`, `setupTests.*`; a module that only
    ends in `-setup` (the Tour Viewer's `creator-setup.ts`) is ordinary
    source;
  - `a mock every test may load`: anything under `__mocks__/`.
  - A config, setup file or mock that the change reaches through imports
    (not through a reader edge) runs that package whole, reason
    `<file> imports the change`.
- Invariants & assumptions:
  - Markdown is a node like any file: a test that reads it by name is reached
    (the design system's `terrain-fixtures.test.mjs` reads
    `fixtures/PROVENANCE.md`), but a changed markdown file alone adds no
    package, and a deleted one is no fallback. The 2026-11-05 claim that no
    unit test reads markdown was wrong (r1125 review).
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
  - Its limit: it injects faults that only a RUNNING test can see. A miss
    that only `tsc`, the build or lint would see (a type-level coupling, a
    build config, a lint rule across files) is invisible to it by
    construction, which is how the r1125 review found the `.d.ts`, tsconfig
    and build-config gaps the replay had passed. Those are pinned by the
    type-level and fallback cases of `impact-graph.test.mjs` and the
    real-workspace case of `graph-dependents.test.mjs` instead.
- Example: in the fixture of `impact-graph.test.mjs`, a change to
  `Fw/src/a.ts` reaches `Fw/src/a.test.ts` and, through `import 'fw'`,
  `Tour/src/view.test.ts`, so `packages` is `['Fw', 'Tour']`.
- Tests: `impact-graph.test.mjs` (one case per edge kind and per fallback)
  and `impact-graph.property.test.mjs` (a changed unit test is always
  selected, more changes never select less, order does not matter). Run in
  the root repo-config gate.
