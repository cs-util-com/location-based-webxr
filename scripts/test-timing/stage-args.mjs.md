> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# stage-args.mjs — full-suite run detection

- Purpose: decides whether a stage invocation is a canonical full-suite run that may be recorded in `docs/test-timings.md`, and safely appends forwarded CLI args to the canonical shell command.
- Public API:
  - `decideRecording(argvRest, env)` → `{ record, extraArgs, reason }`
    - `argvRest`: `process.argv` after the stage name (a leading `--` separator forwarded by pnpm is stripped).
    - `reason`: `'full-suite'` (record), `'filtered'` (extra args forwarded ⇒ never record), `'ci'` (`env.CI` truthy ⇒ never record).
  - `appendArgs(command, extraArgs)` → command string with args appended; args containing whitespace/quotes are double-quoted, embedded `"` escaped.
  - `buildStageCommand(command, decision, filteredRunArgs = [])` → the full shell command for a run. Unfiltered runs (no forwarded args, including CI) return `command` byte-identical; filtered runs get `filteredRunArgs` inserted **before** the forwarded args.
- Invariants & assumptions:
  - Canonical commands live in [stages.mjs](stages.mjs) — they are never forwarded, so ANY forwarded arg means a filtered run. This keeps history rows like-for-like (full runs only).
  - `filteredRunArgs` exist to neutralize checks that are meaningless for a partial run (e.g. `test:unit`'s global coverage thresholds, which made green single-file TDD runs exit 1). They must never leak into full-suite or CI commands — thresholds stay enforced there. Forwarded args stay last, so a developer-forwarded flag wins on conflicts.
  - Inputs are never mutated. Empty-string `CI` counts as not-CI (common CI-detection convention).
  - Quoting is minimal by design: forwarded args are developer-typed file filters/flags, not untrusted input.
- Example:
  ```js
  decideRecording(['--', 'src/foo.test.ts'], process.env);
  // → { record: false, extraArgs: ['src/foo.test.ts'], reason: 'filtered' }
  appendArgs('vitest run', ['src/my tests/a.test.ts']);
  // → 'vitest run "src/my tests/a.test.ts"'
  buildStageCommand('vitest run --coverage', decision, [
    '--coverage.thresholds.lines=0',
  ]);
  // filtered → 'vitest run --coverage --coverage.thresholds.lines=0 src/foo.test.ts'
  ```
- Tests: [stage-args.test.mjs](stage-args.test.mjs) (examples), [stage-args.property.test.mjs](stage-args.property.test.mjs) (record ⟺ no extra args ∧ not CI; input immutability; appendArgs identity/prefix properties; buildStageCommand identity-when-unfiltered, neutralizer ordering, appendArgs reference model).
