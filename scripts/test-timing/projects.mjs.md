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
  - `gateBaseCommand(stage, env)` - the stage's `fastGateCommand` in the
    per-commit gate (`GATE_SKIP_BROWSER_STAGES` set), else its `command`.
    Only the framework's `test:unit` has one: it drops `--coverage`, which
    cost 29 % of that stage (106.4 / 103.9 s against 74.2 / 74.8 s, two quiet
    runs each at 4 workers) against a 15 % bar set before measuring
    (gate-speed plan 2026-10-04, G4 / TS-2). CI, the milestone run and every
    recorded run keep coverage. The Recorder keeps it in every mode: its
    coverage thresholds gate.
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
  - Commands run with cwd = the package dir and the package + workspace-root
    `node_modules/.bin` on PATH.
  - knip cannot see binaries referenced only here — keep root `knip.json`
    `ignoreDependencies` in sync when moving a command in.
- Examples: `getStage(getProject('GpsPlusSlamJs_AppFramework'), 'lint')`
  → `{ name: 'lint', command: 'eslint . …', counts: null }`.
- Tests: `projects.test.mjs` (config invariants + package.json wiring
  cross-check; runs in the root repo-config gate).
