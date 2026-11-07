# changed-files-command.mjs - a format or lint command narrowed to the changed files

- Purpose: the pure rewrite behind the fast gate's format and lint stages
  ([changed-files-stage.mjs](changed-files-stage.mjs.md) is the shell): the
  stage's own command, with its targets replaced by the changed files that
  lie inside them.
- Public API:
  - `narrowCommand(command, changed)` ->
    - `{ mode: 'files', files, command }`: the rewritten command; `files`
      sorted and deduplicated;
    - `{ mode: 'skip', reason }`: no changed file is in the stage;
    - `{ mode: 'full', reason }`: run the command unchanged.
  - `splitCommand(command)`: words, a double-quoted word kept whole.
  - `MAX_FILES` (100).
- Rules:
  - Only `prettier` and `eslint` are rewritten; any other tool, or an option
    the rewrite does not know, runs whole.
  - Targets keep the scope: `.` owns everything, a glob owns what it matches
    (`*.html` does not cross folders), a plain word owns that file or
    folder. An option's value (`--cache-strategy content`) is never a target.
  - prettier: needs `--ignore-unknown`, else whole (a file it cannot parse
    would fail the narrowed run).
  - eslint: only `.js/.ts` family files are passed, and `--no-warn-ignored`
    is added, so a changed file the config ignores is no warning against
    `--max-warnings`.
  - More than `MAX_FILES` files -> whole.
- Invariants & assumptions: a lint rule that reads across files (a changed
  export making another file's import unused) is only seen by the
  package-wide run at the milestone, in a package's own `pnpm test` and in
  CI; typecheck still runs whole in the fast gate.
- Example: `narrowCommand('eslint . --config c.mjs', ['src/a.ts', 'b.css'])`
  -> `{ mode: 'files', files: ['src/a.ts'], command: 'eslint --config c.mjs --no-warn-ignored "src/a.ts"' }`.
- Tests: `changed-files-command.test.mjs` (every target and option kind,
  every fallback); every real format and lint stage of `PROJECTS` parses.
