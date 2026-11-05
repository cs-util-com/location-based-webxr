# projects.mjs — per-package stage config (single source of truth)

> **Adapted from the GpsPlusSlamJs pilot's `stages.mjs`** — see `README.md`
> in this directory. The pilot configures one project; this workspace has one
> `ProjectConfig` per package plus one for the root chain.

- Purpose: canonical definition of every instrumented test gate — stage
  order, full-suite shell commands, and which JSON reporter (vitest /
  playwright / none) yields exact test counts per stage.
- Public API:
  - `PROJECTS: readonly ProjectConfig[]` — `{ name, dir, chainNames, stages }`
    per package; `dir` is workspace-relative (`'.'` = root project).
  - `TOTAL_STAGE` — name of the synthetic full-gate row (`'total'`).
  - `getProject(dirName)` / `resolveProject(cwd, workspaceRoot)` — config
    lookup; `resolveProject` keys on cwd basename (root by path equality) and
    returns `undefined` for unknown dirs (callers fail loudly).
  - `getStage(project, name)`, `stageOrder(project)`.
  - `gateStages(project, { skipBrowser, dependentTrim })` - the stages a gate
    run executes. `skipBrowser` drops the browser stages (dependent mode);
    `dependentTrim` also drops `DEPENDENT_TRIM_STAGES` (`format`,
    `lint:css`, `check:dup`, `check:boundaries`) unless the stage is marked
    `readsUpstreamSources`. `dependentTrimMode(env)` is true only with
    `GATE_SKIP_BROWSER_STAGES` and `GATE_DEPENDENT_TRIM`
    (`DEPENDENT_TRIM_ENV`) both set, which `gateCommands` does for the
    dependents of the per-commit gate only.
    - Why each trimmed stage cannot change a dependent's verdict (checked
      2026-11-05): Prettier, stylelint and jscpd are given the package's own
      paths; every app's depcruise config is `includeOnly: "src"`, except
      the Tour Viewer's, which also includes the editor kit's source, so its
      stage carries `readsUpstreamSources` and stays (pinned against the
      config text). `check:cycles` stays: dpdm follows imports into the
      framework's dist (189 of the Recorder's 289 files). Builds, lint,
      typecheck and unit tests stay.
  - `gateBaseCommand(stage, env)` - the stage's `fastGateCommand` in the
    per-commit gate (`GATE_SKIP_BROWSER_STAGES` set), else its `command`.
    Only the framework's `test:unit` has one: it drops `--coverage`, which
    cost 29 % of that stage (106.4 / 103.9 s against 74.2 / 74.8 s, two quiet
    runs each at 4 workers) against a 15 % bar set before measuring
    (gate-speed plan 2026-10-04, G4 / TS-2). CI, the milestone run and every
    recorded run keep coverage. The Recorder keeps it in every mode but the
    related-only run below: its coverage thresholds gate, and a slice of the
    suite cannot meet them.
    - In the fast gate of a CHANGED package (`GATE_UNIT_RELATED_REF`,
      `UNIT_RELATED_ENV`, set as well; never on the runner) a vitest
      `test:unit` stage becomes
      `node ../scripts/test-changed/related-unit.mjs <command>`
      (`RELATED_UNIT_SCRIPT`), which runs only the tests related to the
      change ([related-unit.mjs](../test-changed/related-unit.mjs.md)). A
      dependent (no ref), the milestone run and a package's own gate (no
      skip switch) keep the command. Pinned by `projects.test.mjs`.
    - On the GitHub runner (`onGithubRunner` from `stage-args.mjs`, i.e.
      `GITHUB_ACTIONS` set, never plain `CI`) a Prettier stage's `--write`
      becomes `--check`, same globs and options: `--write` rewrote the checkout and exited 0, so CI
      had never checked formatting. Local gates (`CI=1`) keep writing.
      Pinned by `projects.test.mjs`, "format stages check on the GitHub
      runner and write everywhere else".
- Invariants & assumptions:
  - Stage `name` === the package.json script name === the md row label; the
    package.json script must invoke `timed-stage.mjs <name>` (enforced by
    `projects.test.mjs` and, at runtime, `chain-guard.mjs`).
  - Commands are the FULL-SUITE form; forwarded args mark a run filtered
    (never recorded). `filteredRunArgs` are inserted only on filtered runs.
  - Every Prettier format command uses `--cache --cache-strategy content`
    (content-hashed, so a cached run formats exactly what an uncached one
    would; gate-speed plan 2026-10-04, G5). ESLint's cache is not used: it
    is unsafe with typed rules. Both are pinned in `projects.test.mjs`.
  - `nestedGate: true` marks a root cascade row that spawns a whole package
    gate (`packageGateStage`); the stage watchdog skips it and watches the
    leaves, so a stall names the leaf. `stallMinutes` is a stage's own
    silence limit (none today; `GATE_STALL_MIN` wins). See
    [stall-watch.mjs](stall-watch.mjs.md). `projects.test.mjs` pins that
    exactly the package-gate rows carry the flag.
  - Commands run with cwd = the package dir and the package + workspace-root
    `node_modules/.bin` on PATH.
  - knip cannot see binaries referenced only here — keep root `knip.json`
    `ignoreDependencies` in sync when moving a command in.
- Examples: `getStage(getProject('GpsPlusSlamJs_AppFramework'), 'lint')`
  → `{ name: 'lint', command: 'eslint . …', counts: null }`.
- Tests: `projects.test.mjs` (config invariants + package.json wiring
  cross-check; runs in the root repo-config gate).
