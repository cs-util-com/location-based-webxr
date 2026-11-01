# project-runs.mjs - pure rules of the per-project e2e runner

- Purpose: the decisions of [`run-projects.mjs`](run-projects.mjs.md) that
  need no I/O, kept pure so each is unit-tested.
- Public API:
  - `DOM_WORKERS_ENV` (`E2E_DOM_WORKERS`), `CHANGED_REF_ENV`
    (`GATE_CHANGED_REF`, set by `scripts/test-changed/select.mjs` on the
    changed packages' full gates).
  - `domWorkers(env, localDefault)`: 1 on the GitHub runner
    (`onGithubRunner` from `scripts/test-timing/stage-args.mjs`); otherwise
    `E2E_DOM_WORKERS` when set, else `localDefault`. Throws `RangeError` on
    an override that is not a whole number from 1 to 16.
  - `mayNarrow(env, forwarded)`: true only off the runner, with
    `GATE_CHANGED_REF` set, and with no forwarded argument other than
    `--reporter=...` (the gate's recording flag).
  - `specFilter(name)`: a Playwright file filter (a regular expression over
    the file path) matching exactly that file name after a slash of either
    style; no colon, which the CLI would read as a line number.
  - `projectArgs({ base, project, workers, specs })`: `base`, then
    `--project`, `--workers`, `--pass-with-no-tests`, then one filter per
    spec.
  - `mergeReports(reports)`: one Playwright JSON report from runs that ran in
    sequence: suites and errors concatenated, `expected`, `unexpected`,
    `flaky`, `skipped` and `duration` summed, the first run's config and
    start time. Throws `TypeError` on an empty list or a report without
    `stats`.
  - `projectReportName(file, project)`: `results.json` -> `results.dom.json`.
- Invariants & assumptions: the GitHub runner never narrows and runs the DOM
  specs at one worker, as before the split; the merged duration is a sum,
  correct only because the runs never overlap.
- Example: `projectArgs({ base: ['test'], project: 'webgl', workers: 1 })` ->
  `['test', '--project', 'webgl', '--workers', '1', '--pass-with-no-tests']`.
- Tests: `project-runs.test.mjs`, `project-runs.property.test.mjs`.
