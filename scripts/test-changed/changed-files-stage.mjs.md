# changed-files-stage.mjs - format on the changed files (CLI shell)

- Purpose: in the per-commit fast gate, a package's `format` stage checks
  only the files changed against the gate's ref; everywhere else it checks
  the whole package. Lint always runs whole (see
  [changed-files-command.mjs](changed-files-command.mjs.md) for why). Runs the plan of
  [changed-files-command.mjs](changed-files-command.mjs.md).
- Public API (CLI, from a package dir):
  `node ../scripts/test-changed/changed-files-stage.mjs <command...>`, with
  `GATE_UNIT_RELATED_REF` set to the diff base. Exit code = the tool's (0 on
  a skip). `gateBaseCommand` in
  [projects.mjs](../test-timing/projects.mjs.md) builds this command for the
  `format` stage, only with `GATE_SKIP_BROWSER_STAGES` and the
  ref set, never on the GitHub runner.
- Invariants & assumptions:
  - Prints ONE line: `changed-files: only the N changed file(s) ...`,
    `changed-files: no changed file is in this stage, so it does not run ...`
    or `changed-files: whole package - <reason>`.
  - Changed files: `changedFiles(ref, root)`
    ([changed-paths.mjs](changed-paths.mjs.md)), limited to the package,
    deleted ones dropped.
  - A dependent the graph chose has no changed file of its own, so its
    format does not run; its lint, typecheck and reached unit tests do.
  - The arguments arrive unquoted from the shell; a word with a space or a
    glob character is quoted again before the whole command is rebuilt (it
    runs as the package script wrote it, through a shell).
  - The narrowed command runs as an argv through node and the tool's own bin
    ([package-bin.mjs](package-bin.mjs.md)), with no shell, so a file name
    with a `$`, a backtick or a `"` reaches the tool verbatim (r1139).
- Example: a Tour Viewer commit touching 3 modules formats those 3 files
  instead of the whole package.
- Tests: the rewrite in `changed-files-command.test.mjs`; the wiring in
  `projects.test.mjs` ("format on the changed files in the fast gate
  only"); the shell by real fast-gate runs.
