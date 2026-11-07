# changed-files-stage.mjs - format and lint on the changed files (CLI shell)

- Purpose: in the per-commit fast gate, a package's `format` and `lint`
  stages check only the files changed against the gate's ref; everywhere
  else they check the whole package. Runs the plan of
  [changed-files-command.mjs](changed-files-command.mjs.md).
- Public API (CLI, from a package dir):
  `node ../scripts/test-changed/changed-files-stage.mjs <command...>`, with
  `GATE_UNIT_RELATED_REF` set to the diff base. Exit code = the tool's (0 on
  a skip). `gateBaseCommand` in
  [projects.mjs](../test-timing/projects.mjs.md) builds this command for the
  `format` and `lint` stages, only with `GATE_SKIP_BROWSER_STAGES` and the
  ref set, never on the GitHub runner.
- Invariants & assumptions:
  - Prints ONE line: `changed-files: only the N changed file(s) ...`,
    `changed-files: no changed file is in this stage, so it does not run ...`
    or `changed-files: whole package - <reason>`.
  - Changed files: `changedFiles(ref, root)`
    ([changed-paths.mjs](changed-paths.mjs.md)), limited to the package,
    deleted ones dropped.
  - A dependent the graph chose has no changed file of its own, so its
    format and lint do not run; its typecheck and reached unit tests do.
  - The arguments arrive unquoted from the shell; a word with a space or a
    glob character is quoted again before the command is rebuilt.
- Example: a Tour Viewer commit touching 3 modules lints those 3 files
  instead of the whole package.
- Tests: the rewrite in `changed-files-command.test.mjs`; the wiring in
  `projects.test.mjs` ("format and lint on the changed files in the fast
  gate only"); the shell by real fast-gate runs.
