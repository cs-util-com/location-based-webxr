# related-tests.mjs - which unit tests a change can reach

- Purpose: the pure plan behind the per-commit fast gate's related-only unit
  run in a CHANGED package (`related-unit.mjs` is the shell): the files to
  hand to `vitest related`, or the reason the full suite must run.
- Public API:
  - `planRelatedRun({ changed, deleted, testFiles, maxFiles? })` ->
    `{ mode: 'related', files }` (sorted, deduplicated; empty means no unit
    test can read the change) or `{ mode: 'full', reason }`.
    - `changed`: package-relative paths that differ from the gate's ref,
      untracked ones included; `deleted`: those no longer on disk;
      `testFiles`: the package's unit test files with their text.
  - `relatedVitestArgs(fullCommand, files)` -> the vitest arguments
    (`related --run <the command's other args> <files>`, `--coverage`
    dropped), or `null` when the command is not a plain `vitest run`.
  - `upstreamChange({ changed, packageDir, packages })` -> the first
    repo-relative changed path inside a workspace package this one depends
    on (directly or transitively), or `null`. `related-unit.mjs` runs the
    full suite on one: an app's tests can import an upstream package's
    source through an alias, which a package-local related run cannot see.
  - `DEFAULT_MAX_FILES` (150).
- Rules, in order:
  - Markdown (sidecars, docs) and the generated `docs/test-timings.md` are
    ignored: no unit test reads markdown (checked by search across every
    package on 2026-11-05: the only `.md` mentions in tests are comments).
  - More than `maxFiles` changes, a deleted or renamed file (its importers
    are no longer in the graph), a setup file (`*setup.ts`, loaded before
    every test without an import) or anything under `__mocks__/` -> full.
  - A module under `src/` (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`,
    test files included) goes to vitest's graph; a `.css` or `.html` file is
    passed too (harmless; no test imports it); a file under
    `playwright-tests/` is read by no unit test.
  - Anything else (configs, `package.json`, `tsconfig*.json`, data and
    fixtures, `scripts/`, `public/`) -> full.
  - Widening, because vitest's graph cannot see a read through `fs`:
    - READERS: a test that calls an `fs` read and names the basename of a
      changed file (page markup, a stylesheet, another module's source text);
    - SCANNERS: a test that walks a directory (`readdirSync`,
      `import.meta.glob`, `globSync`), whenever a module source changed.
- Invariants & assumptions: spiked against vitest 5.0.0 in the Tour Viewer:
  a changed module selects the tests importing it (through the package's own
  aliases and source-consumed workspace packages), a changed test file
  selects itself, a stylesheet or page selects nothing. What it still misses,
  by design and reaching the milestone run or CI instead: a test broken
  without an import or a named read (a file name built at run time, state
  leaking between files, a `vi.mock` of a path the change does not import).
- Example: `planRelatedRun({ changed: ['index.html'], deleted: [],
  testFiles: [{ path: 'src/page.test.ts', text: "readFileSync('index.html')" }] })`
  -> `{ mode: 'related', files: ['index.html', 'src/page.test.ts'] }`.
- Tests: `related-tests.test.mjs` (one case per rule),
  `related-tests.property.test.mjs` (no changed source dropped, scanners
  always added, only out-of-class paths force the full suite, order
  insensitive). Run in the root repo-config gate.
