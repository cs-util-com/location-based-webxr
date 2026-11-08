# changed-files-command.mjs - a format command narrowed to the changed files

- Purpose: the pure rewrite behind the fast gate's format stage
  ([changed-files-stage.mjs](changed-files-stage.mjs.md) is the shell): the
  stage's own command, with its targets replaced by the changed files that
  lie inside them.
- Public API:
  - `narrowCommand(command, changed)` ->
    - `{ mode: 'files', files, argv }`: the rewritten command as an argv
      (`[tool, ...options, ...files]`), which the stage runs without a
      shell, so a file name with `# changed-files-command.mjs - a format command narrowed to the changed files

- Purpose: the pure rewrite behind the fast gate's format stage
  ([changed-files-stage.mjs](changed-files-stage.mjs.md) is the shell): the
  stage's own command, with its targets replaced by the changed files that
  lie inside them.
- Public API:
  - `narrowCommand(command, changed)` ->
, a backtick or a `"` reaches the tool
      verbatim (r1139); `files` sorted and deduplicated;
    - `{ mode: 'skip', reason }`: no changed file is in the stage;
    - `{ mode: 'full', reason }`: run the command unchanged.
  - `splitCommand(command)`: words, a double-quoted word kept whole.
  - `MAX_FILES` (100).
- Rules:
  - Only `prettier` is rewritten; any other tool, or an option the rewrite
    does not know, runs whole.
  - `eslint` is deliberately not rewritten (r1125 review): its typed rules
    read across files, so a change in one file can raise an error in
    another, and a `--max-warnings` budget (37 in the framework, 22 in the
    Recorder) counts the whole package. A narrowed lint proved neither, and
    a dependent with no changed file of its own linted nothing at all.
  - Targets keep the scope: `.` owns everything, a glob owns what it matches
    (`*.html` does not cross folders), a plain word owns that file or
    folder. An option's value (`--cache-strategy content`) is never a target.
  - prettier: needs `--ignore-unknown`, else whole (a file it cannot parse
    would fail the narrowed run).
  - More than `MAX_FILES` files -> whole.
- Invariants & assumptions: formatting is per file, so narrowing it loses
  nothing; lint and typecheck run whole in the fast gate.
- Example: `narrowCommand('prettier --write --ignore-unknown "src"', ['src/a.ts', 'b.css'])`
  -> `{ mode: 'files', files: ['src/a.ts'], argv: ['prettier', '--write', '--ignore-unknown', 'src/a.ts'] }`.
- Tests: `changed-files-command.test.mjs` (every target and option kind,
  every fallback, and that a lint command runs whole).
