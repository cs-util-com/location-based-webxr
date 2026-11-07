# graph-dependents.mjs - which dependents the fast gate runs

- Purpose: in the per-commit fast gate, run only the dependent packages the
  cross-package import graph ([impact-graph.mjs](impact-graph.mjs.md))
  reaches, instead of pnpm's whole `...<name>` closure. Called by
  [test-changed.mjs](test-changed.mjs.md); its result becomes the
  `dependents` option of `gateCommands` ([select.mjs](select.mjs.md)).
- Public API: `graphDependents({ root, ref, changedDirs })` ->
  `{ dirs, line }`.
  - `dirs`: the reached package dirs beyond `changedDirs`, sorted; `[]` when
    the change reaches no other package (a test-only change); `undefined`
    when the graph could not be built, which means "every dependent runs".
  - `line`: the one log line that says which, including how many unit test
    files the dependents run and which run their whole suite.
- Invariants & assumptions: reads git and the work tree (through
  `changedFiles` in [changed-paths.mjs](changed-paths.mjs.md) and
  `loadImpactGraph` in [workspace-tree.mjs](workspace-tree.mjs.md)); never
  throws.
- Example: a change to `Fw/src/a.ts` that only `Tour` imports gives
  `{ dirs: ['Tour'], line: 'test-changed: the import graph reaches Tour (1 unit test file(s)); other dependents run nothing' }`.
- Tests: `graph-dependents.test.mjs`, end to end on a throwaway git
  workspace: the emitted command is `--filter tour`, a test-only change runs
  no dependent, a missing root falls back to every dependent.
