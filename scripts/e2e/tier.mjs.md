# tier.mjs - the per-PR browser tier and the full set

- Purpose: chooses what a Playwright run selects. `E2E_TIER=pr` (the
  default, also when unset) runs the tests whose title ends in the `@pr` tag
  plus every test of a spec file the branch adds or changes; `E2E_TIER=full`
  runs every test. Every package's Playwright config reads it (`grep`,
  `retries`), `run-projects.mjs` reads it (whether an empty run may pass),
  and `scripts/test-timing/run-stage.mjs` reads it (a tier run records no
  timing row).
- Public API:
  - `TIER_ENV` (`E2E_TIER`), `TIER_BASE_ENV` (`E2E_TIER_BASE`),
    `DEVELOPER_FILTER_ENV` (`E2E_DEVELOPER_FILTER`), `TIERS`.
  - `e2eTier(env)`: `"pr"` or `"full"`; throws `RangeError` on any other
    value, so a typo never picks a tier.
  - `tierRetries(env, localRetries = 0)`: on CI 1 in the tier, 2 in the
    full set; locally the package's own count.
  - `tierGrep(env, wholeSpecs)`: `RegExp[]` for the tier (the tag, plus one
    pattern per spec file name that runs whole), `undefined` for the full
    set. Matched against Playwright's grep string ("project file describe
    title tags"); a file pattern is anchored on a path separator, so
    `stations.spec.js` does not select `creator-stations.spec.js`.
  - `changedSpecNames(paths, pkg)`: the `*.spec.{js,mjs}` file names among
    changed repo paths inside one package folder.
  - `developerSelected(argv, env)`: whether the command line holds a
    developer's own selection (a file filter, `-g`/`--grep`,
    `--last-failed`, `--only-changed`, a test list). `E2E_DEVELOPER_FILTER`
    (`1`/`0`, set by `run-projects.mjs`, whose command line carries its own
    spec filters) overrides the reading.
  - `tierStageRun(stage, env)`: a `counts: "playwright"` stage in the tier
    (no timing row).
  - `passesEmpty({ developerFiltered, narrowed, env })`: whether a run that
    selects no test may pass: a developer's filter, or a tier run cut to the
    changed area by `test:changed` (its specs may hold no tagged test).
  - `playwrightGrep(configUrl, { env, argv, io })`: a config's `grep`.
    The changed specs are diffed against `GATE_CHANGED_REF` (the milestone
    browser run, `test:changed --ref`) or else `E2E_TIER_BASE` (CI: the pull
    request's base commit); with neither, only the tag. `undefined` in the
    full set or for a developer's selection. Throws when the base cannot be
    diffed (an unknown ref), so the run stops instead of skipping a changed
    spec. The answer is left in `E2E_TIER_RESOLVED` for the run's workers,
    which load the config again; it is keyed by the config's folder.
- Invariants & assumptions:
  - **An empty selection fails.** Playwright exits 1 with "No tests found"
    when its grep matches nothing and `--pass-with-no-tests` is not given;
    only `passesEmpty` adds that flag, and only in the Tour Viewer's runner.
    Proven against Playwright itself in `tier.test.mjs`.
  - The tier is an environment variable, never a forwarded argument: any
    forwarded argument is a developer's filter, which may select nothing.
  - A developer's file filter is never narrowed by the tier: naming a spec
    runs the whole file, as before the tier existed. An unknown option
    followed by a value reads the value as a filter, which turns the tier
    off: more tests, never fewer.
  - A spec helper (not a `*.spec.*` file) that changes does not widen the
    tier; the full run covers it.
  - The tagged set is pinned per package by
    `tests/repo-config/e2e-pr-tier.test.js`, which also checks that every
    config reads this module and that every Tour Viewer CI lane holds a
    tagged test (a lane job that selects nothing fails).
- Examples:
  - The full set locally: `E2E_TIER=full pnpm run test:e2e`.
  - A package's own `pnpm test` runs the tier (no base: the tag only); add
    `E2E_TIER_BASE=origin2/main` to also run the specs changed since then.
- Tests: `scripts/e2e/tier.test.mjs` (the rules, and a throwaway Playwright
  suite for the empty-selection failure and the whole changed spec);
  `tests/repo-config/e2e-pr-tier.test.js` (the tagged set and the config
  wiring); `tests/repo-config/ci-jobs.test.js` (the workflow's tier choice).
