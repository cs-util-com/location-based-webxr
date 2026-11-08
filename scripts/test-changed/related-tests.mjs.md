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
  - `mergeImpact({ plan, impact, packageDir })` -> the own plan plus this
    package's tests in `impact.tests` (package-relative, sorted), or
    `{ mode: 'full', reason }` when `impact.fullSuite` names
    `packageDir`; a full own plan stays full.
  - `DEFAULT_MAX_FILES` (150).
- Rules, in order:
  - Markdown (sidecars, docs) is never handed to vitest and never forces
    the full suite, but it selects the tests that read it by name (the
    design system's `terrain-fixtures.test.mjs` reads `PROVENANCE.md`; the
    2026-11-05 search that said no test reads markdown missed it). A deleted
    markdown file selects nothing. The generated `docs/test-timings.md` is
    ignored.
  - More than `maxFiles` changes, a deleted or renamed file (its importers
    are no longer in the graph), a setup file (`setup.*`, `test-setup.*`,
    `vitest.setup.*`, `setupTests.*`, loaded before every test without an
    import; `creator-setup.ts` is ordinary source) or anything under `__mocks__/` -> full.
  - A module under `src/` (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`,
    test files included) goes to vitest's graph; a `.css` or `.html` file is
    passed too (harmless; no test imports it); a file under
    `playwright-tests/` is read by no unit test.
  - Anything else (configs, `package.json`, `tsconfig*.json`, data and
    fixtures, `scripts/`, `public/`) -> full.
  - Widening, because vitest's graph cannot see a read through `fs`:
    - READERS: a test that calls an `fs` read and names the basename of a
      changed file (page markup, a stylesheet, another module's source text);
    - SCANNERS: a test that walks a directory (`readdirSync`, `readdir(`,
      `globSync`, `fs.glob`, `opendirSync`, and in its own package
      `import.meta.glob`), whenever a module source changed.
    - The setup, scanner and reader patterns (`isSetupFile`, `SCANNER_RE`,
      `FS_READ_RE`, `MODULE_RE`) come from [impact-graph.mjs](impact-graph.mjs.md),
      the one source both paths read (r1139; the two copies had drifted).
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
