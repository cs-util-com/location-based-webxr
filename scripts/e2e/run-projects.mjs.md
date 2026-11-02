# run-projects.mjs - a package's Playwright projects, one after the other

- Purpose: the Tour Viewer's `test:e2e` stage command
  (`scripts/test-timing/projects.mjs`). Runs its `dom` project at several
  workers, then its `webgl` project at one, so the DOM specs share the CPU
  while two software-rendered WebGL scenes never do; inside a
  `test:changed` run it narrows both to the specs the change can reach.
- Public API (CLI):
  `node ../scripts/e2e/run-projects.mjs <plan.js> playwright test --config <config> [forwarded...]`,
  run from the package. `<plan.js>` exports `PROJECTS`, `SPECS`,
  `specsOf`, `LOCAL_DOM_WORKERS`, `RESULTS_DIR`, `RESULTS_NAME` and
  `selectSpecs` (see
  [`e2e-plan.js`](../../GpsPlusSlamJs_TourViewer/playwright-tests/e2e-plan.js.md)).
  Forwarded arguments (a developer's filter, the gate's `--reporter=list,json`)
  go to every project's run; a developer's filter also adds
  `--pass-with-no-tests` (it may match only the other project's specs),
  nothing else does. Exit code: the first non-zero one, else 1 when a report
  was unreadable, else 0; 2 on a malformed command line.
- Invariants & assumptions:
  - **Every project runs**, even after a red one. This is why it is not
    Playwright's project `dependencies`, which skip a dependent project when
    its dependency fails.
  - **The JSON reports are merged**: the config's own reporter on CI
    (`E2E_RESULTS_NAME` per project inside `RESULTS_DIR`) and the gate's
    injected one (`PLAYWRIGHT_JSON_OUTPUT_NAME`, when run-stage records) are
    written per project and merged into the file their reader expects, so
    the timing row and its counts cover both projects. Each project's
    report is read **right after its run**: the config's file sits inside
    Playwright's output folder (`test-results/`), which the next project's
    run empties when it starts; the first measurement lost the `dom` report
    exactly that way (2026-11-01). A report that should exist (the config's
    in CI mode, the gate's whenever it is asked for) but is missing is warned
    about; an unreadable one (truncated) is warned about and fails the run,
    but only after every project ran (`readReport`). The GitHub workflow
    uploads only the Recorder's results, not this merged file.
  - **Narrowing** (`mayNarrow` in [`project-runs.mjs`](project-runs.mjs.md)):
    only off the GitHub runner, only with `GATE_CHANGED_REF` set (the
    changed packages' full gates under `test:changed`), only without a
    developer's filter. It prints one `e2e areas:` line naming what runs. A
    project with no selected spec is skipped; an unknown path selects all.
    Such a run records no timing row (`narrowedStageRun`). Real-Playwright
    check, 2026-11-01: see the r1012 entry of the globe editor feedback plan.
  - The worker count: `domWorkers` for the first project, 1 for the rest.
  - Playwright is resolved from the package (`@playwright/test/cli`) and run
    with the same Node.
- Example: from `GpsPlusSlamJs_TourViewer`,
  `E2E_DOM_WORKERS=2 node ../scripts/e2e/run-projects.mjs playwright-tests/e2e-plan.js playwright test --config playwright-tests/playwright.config.js`.
- Tests: the pure rules in `project-runs.test.mjs` and its property test;
  the plan in `tests/repo-config/tour-viewer-e2e-plan.test.js`; the stage
  command in `scripts/test-timing/projects.test.mjs`. The process wiring
  itself (spawn, merge on disk) is exercised by every Tour Viewer e2e run
  and was checked by the 2026-11-01 measurement runs.
